import type { ClaudeClient, ClaudeRunInput, ClaudeRunResult } from './claude-client';

export type StubResponder = (input: ClaudeRunInput) => unknown | Promise<unknown>;

export class StubClaudeClient implements ClaudeClient {
  constructor(private readonly responders: Record<string, StubResponder>) {}

  async run(input: ClaudeRunInput): Promise<ClaudeRunResult> {
    const responder = this.responders[input.agentName];
    if (!responder) throw new Error(`No responder for agent: ${input.agentName}`);
    const started = Date.now();
    const result = await responder(input);
    const text = JSON.stringify(result);
    return {
      text,
      tokensIn: 100,
      tokensOut: text.length / 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: Date.now() - started,
    };
  }
}
