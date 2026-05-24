import { describe, it, expect, vi } from 'vitest';
import { RealClaudeClient } from '../src/real-claude-client';

describe('RealClaudeClient', () => {
  it('passes prompt + system + agent name to the underlying query function', async () => {
    const fakeMessages = [
      { type: 'assistant', message: { content: [{ type: 'text', text: '{"status":"healthy"}' }] } },
      { type: 'result', subtype: 'success', total_cost_usd: 0.01, usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    ];
    const queryFn = vi.fn().mockImplementation(async function* () {
      for (const m of fakeMessages) yield m;
    });
    const client = new RealClaudeClient({ queryFn, defaultModel: 'claude-sonnet-4-6' });
    const out = await client.run({
      agentName: 'auth-service-investigator',
      systemPrompt: 'You are an SRE...',
      userPayload: { window: { from: 'a', to: 'b' } },
    });
    expect(out.text).toBe('{"status":"healthy"}');
    expect(out.tokensIn).toBe(500);
    expect(out.tokensOut).toBe(50);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const call = queryFn.mock.calls[0][0];
    expect(call.options.systemPrompt).toContain('SRE');
  });
});
