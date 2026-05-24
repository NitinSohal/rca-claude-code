import { describe, it, expect } from 'vitest';
import { buildSubagentCall, buildSynthesizerCall } from '../src/prompt-builder';

describe('buildSubagentCall', () => {
  it('returns systemPrompt with prose marked cacheable + user payload with prefetch', () => {
    const { systemPrompt, userPayload, agentName } = buildSubagentCall({
      componentName: 'auth-service',
      promptMd: 'GENERATED PROMPT FILE',
      window: { from: 'a', to: 'b' },
      prefetched: { window: { from: 'a', to: 'b' }, loki: { error_lines: [], stats: { total_lines: 0 } }, prometheus: {}, cloudwatch: {}, data_unavailable: false },
    });
    expect(agentName).toBe('auth-service-investigator');
    expect(systemPrompt).toContain('GENERATED PROMPT FILE');
    expect((userPayload as any).window.from).toBe('a');
    expect((userPayload as any).prefetched).toBeDefined();
  });
});

describe('buildSynthesizerCall', () => {
  it('packs all subagent outputs + dependency graph + past RCAs', () => {
    const c = buildSynthesizerCall({
      infraMd: 'INFRA MD CONTENT',
      dependencyGraph: { a: ['b'] },
      subagentOutputs: [{ component: 'a' } as any],
      pastRcas: [{ id: 'r1', summary: 's' }],
      window: { from: 'a', to: 'b' },
    });
    expect(c.systemPrompt).toContain('INFRA MD CONTENT');
    expect(c.systemPrompt).toContain('synthesizer');
    expect((c.userPayload as any).subagent_outputs.length).toBe(1);
    expect((c.userPayload as any).past_rcas.length).toBe(1);
  });
});
