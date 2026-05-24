import { describe, it, expect } from 'vitest';
import { StubClaudeClient } from '../src/stub-claude-client';

describe('StubClaudeClient', () => {
  it('routes by agentName to the matching responder', async () => {
    const stub = new StubClaudeClient({
      'auth-service-investigator': () => ({
        component: 'auth-service',
        status: 'healthy',
        confidence: 0.9,
        findings: [],
        suspected_dependencies: [],
        notes: '',
      }),
    });
    const out = await stub.run({
      agentName: 'auth-service-investigator',
      systemPrompt: '...',
      userPayload: { window: { from: 'a', to: 'b' }, loki: {}, prometheus: {}, cloudwatch: {} },
    });
    expect(JSON.parse(out.text).status).toBe('healthy');
    expect(out.tokensIn).toBeGreaterThan(0);
    expect(out.tokensOut).toBeGreaterThan(0);
  });
  it('throws when no responder is registered', async () => {
    const stub = new StubClaudeClient({});
    await expect(
      stub.run({ agentName: 'missing', systemPrompt: '', userPayload: {} }),
    ).rejects.toThrow(/no responder/i);
  });
  it('respects async responders that delay', async () => {
    const stub = new StubClaudeClient({
      slow: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true };
      },
    });
    const out = await stub.run({ agentName: 'slow', systemPrompt: '', userPayload: {} });
    expect(JSON.parse(out.text).ok).toBe(true);
  });
});
