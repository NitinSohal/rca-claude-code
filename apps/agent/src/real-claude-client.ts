import type { ClaudeClient, ClaudeRunInput, ClaudeRunResult } from './claude-client';

interface QueryFnArg {
  prompt: string;
  options: {
    systemPrompt?: string;
    model?: string;
    maxTurns?: number;
    abortController?: AbortController;
  };
}

interface AssistantMessage {
  type: 'assistant';
  message: { content: Array<{ type: string; text?: string }> };
}
interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}
type AnyMessage = AssistantMessage | ResultMessage | { type: string };

export type QueryFn = (arg: QueryFnArg) => AsyncIterable<AnyMessage>;

export interface RealClaudeClientOptions {
  queryFn: QueryFn;
  defaultModel?: string;
  maxTurns?: number;
}

export class RealClaudeClient implements ClaudeClient {
  constructor(private readonly opts: RealClaudeClientOptions) {}

  async run(input: ClaudeRunInput): Promise<ClaudeRunResult> {
    const started = Date.now();
    const ac = new AbortController();
    if (input.signal) input.signal.addEventListener('abort', () => ac.abort());
    if (input.timeoutMs) setTimeout(() => ac.abort(), input.timeoutMs);

    const stream = this.opts.queryFn({
      prompt: JSON.stringify(input.userPayload),
      options: {
        systemPrompt: input.systemPrompt,
        model: this.opts.defaultModel ?? 'claude-sonnet-4-6',
        maxTurns: this.opts.maxTurns ?? 8,
        abortController: ac,
      },
    });

    let text = '';
    let usage: ResultMessage['usage'] | undefined;
    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const block of (msg as AssistantMessage).message.content) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      } else if (msg.type === 'result') {
        usage = (msg as ResultMessage).usage;
      }
    }

    return {
      text: text.trim(),
      tokensIn: usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - started,
    };
  }
}
