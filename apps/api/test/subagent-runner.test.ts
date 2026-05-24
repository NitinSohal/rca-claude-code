import { describe, it, expect, vi } from 'vitest';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { StubClaudeClient } from '@rca/agent';

describe('SubagentRunner', () => {
  it('returns parsed SubagentOutput on success', async () => {
    const client = new StubClaudeClient({
      'auth-service-investigator': () => ({
        component: 'auth-service',
        status: 'healthy',
        confidence: 0.9,
        findings: [],
        suspected_dependencies: [],
        notes: 'ok',
      }),
    });
    const runner = new SubagentRunner(client, { timeoutMs: 200 });
    const out = await runner.run({
      componentName: 'auth-service',
      promptMd: 'PROMPT',
      window: { from: 'a', to: 'b' },
      prefetched: {},
    });
    expect(out.output.status).toBe('healthy');
    expect(out.tokens.input).toBeGreaterThan(0);
  });

  it('treats invalid JSON as inconclusive with notes', async () => {
    const client = { run: vi.fn().mockResolvedValue({ text: 'not json', tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1 }) };
    const runner = new SubagentRunner(client as any, { timeoutMs: 200 });
    const out = await runner.run({
      componentName: 'x',
      promptMd: 'p',
      window: { from: 'a', to: 'b' },
      prefetched: {},
    });
    expect(out.output.status).toBe('inconclusive');
    expect(out.output.notes).toMatch(/json/i);
  });

  it('retries once on a thrown error then succeeds', async () => {
    let n = 0;
    const client = {
      run: vi.fn().mockImplementation(async () => {
        n++;
        if (n === 1) throw new Error('5xx');
        return {
          text: JSON.stringify({
            component: 'x',
            status: 'healthy',
            confidence: 0.9,
            findings: [],
            suspected_dependencies: [],
            notes: '',
          }),
          tokensIn: 100,
          tokensOut: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          durationMs: 1,
        };
      }),
    };
    const runner = new SubagentRunner(client as any, { timeoutMs: 200 });
    const out = await runner.run({ componentName: 'x', promptMd: 'p', window: { from: 'a', to: 'b' }, prefetched: {} });
    expect(out.output.status).toBe('healthy');
    expect(client.run).toHaveBeenCalledTimes(2);
  });

  it('returns inconclusive with notes="timeout" when timeout fires', async () => {
    const client = {
      run: vi.fn().mockImplementation(async (input: any) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ text: '{}', tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1 }), 200);
          input.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
          });
        });
      }),
    };
    const runner = new SubagentRunner(client as any, { timeoutMs: 20 });
    const out = await runner.run({ componentName: 'slow', promptMd: 'p', window: { from: 'a', to: 'b' }, prefetched: {} });
    expect(out.output.notes).toBe('timeout');
  });
});
