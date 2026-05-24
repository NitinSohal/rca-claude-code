import { Injectable } from '@nestjs/common';
import {
  buildSubagentCall,
  SubagentOutputSchema,
  type ClaudeClient,
  type SubagentOutput,
} from '@rca/agent';

export interface SubagentRunInput {
  componentName: string;
  promptMd: string;
  window: { from: string; to: string };
  prefetched: unknown;
}

export interface SubagentRunResult {
  output: SubagentOutput;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  durationMs: number;
}

export interface SubagentRunnerOpts {
  timeoutMs: number;
}

@Injectable()
export class SubagentRunner {
  constructor(
    private readonly claude: ClaudeClient,
    private readonly opts: SubagentRunnerOpts = { timeoutMs: 90_000 },
  ) {}

  async run(input: SubagentRunInput): Promise<SubagentRunResult> {
    const call = buildSubagentCall(input);
    const attempts = 2;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs);
        const r = await this.claude.run({
          agentName: call.agentName,
          systemPrompt: call.systemPrompt,
          userPayload: call.userPayload,
          timeoutMs: this.opts.timeoutMs,
          signal: ac.signal,
        });
        clearTimeout(timer);

        const parsed = parseSubagentJson(r.text, input.componentName);
        return {
          output: parsed,
          tokens: {
            input: r.tokensIn,
            output: r.tokensOut,
            cache_read: r.cacheReadTokens,
            cache_write: r.cacheWriteTokens,
          },
          durationMs: r.durationMs,
        };
      } catch (err) {
        lastError = err as Error;
        if ((err as Error).name === 'AbortError' || (err as Error).message?.includes('abort')) {
          return inconclusive(input.componentName, 'timeout', 0);
        }
      }
    }
    return inconclusive(input.componentName, `error: ${lastError?.message ?? 'unknown'}`, 0);
  }
}

function parseSubagentJson(text: string, componentName: string): SubagentOutput {
  let parsed: unknown;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return {
      component: componentName,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes: 'json parse error',
    };
  }
  const r = SubagentOutputSchema.safeParse(parsed);
  if (!r.success) {
    return {
      component: componentName,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes: `schema validation failed: ${r.error.message.slice(0, 200)}`,
    };
  }
  return r.data;
}

function inconclusive(component: string, notes: string, _attempts: number): SubagentRunResult {
  return {
    output: {
      component,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes,
    },
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    durationMs: 0,
  };
}
