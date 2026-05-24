export interface ClaudeRunInput {
  agentName: string;
  systemPrompt: string;
  userPayload: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ClaudeRunResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
}

export interface ClaudeClient {
  run(input: ClaudeRunInput): Promise<ClaudeRunResult>;
}

export const CLAUDE_CLIENT = Symbol.for('ClaudeClient');
