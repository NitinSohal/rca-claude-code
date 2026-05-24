import { describe, it, expect } from 'vitest';
import { SynthesizerService } from '../src/synthesizer/synthesizer.service';
import { StubClaudeClient } from '@rca/agent';

describe('SynthesizerService', () => {
  it('returns a validated RcaOutput on success', async () => {
    const stub = new StubClaudeClient({
      synthesizer: () => ({
        summary: 's',
        root_cause: { component: 'postgres-primary', description: 'pool exhausted', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: ['raise pool'],
        similar_past_rcas: [],
      }),
    });
    const synth = new SynthesizerService(stub);
    const out = await synth.synthesize({
      infraMd: 'INFRA',
      dependencyGraph: {},
      subagentOutputs: [],
      pastRcas: [],
      window: { from: 'a', to: 'b' },
    });
    expect(out.rca.root_cause.component).toBe('postgres-primary');
    expect(out.degraded).toBe(false);
  });

  it('marks degraded=true on invalid JSON and returns a fallback RCA', async () => {
    const client = {
      run: async () => ({
        text: 'totally not json',
        tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1,
      }),
    };
    const synth = new SynthesizerService(client as any);
    const out = await synth.synthesize({
      infraMd: '', dependencyGraph: {}, subagentOutputs: [], pastRcas: [], window: { from: 'a', to: 'b' },
    });
    expect(out.degraded).toBe(true);
    expect(out.rca.summary).toMatch(/synthesizer/i);
  });
});
