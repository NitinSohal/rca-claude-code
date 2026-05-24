import { describe, it, expect } from 'vitest';
import { RcaController } from '../src/rca/rca.controller';

describe('RcaController.create', () => {
  it('validates from/to and delegates to ExpandLoopService', async () => {
    const fake = {
      runCycle: async (input: any) => ({ runId: 'r1', rcaId: 'a1', rca: { summary: 's' }, iterations: 1, stopReason: 'success', degraded: false }),
    };
    const infra = {
      getComponents: () => [{ name: 'a' }],
      getProse: () => 'prose',
      getDependencyGraph: () => ({}),
    };
    const promptRead = { read: (name: string) => `prompt-for-${name}` };
    const ctrl = new RcaController(fake as any, infra as any, promptRead as any);
    const r = await ctrl.create({
      from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z', autoExpand: false,
    });
    expect(r.runId).toBe('r1');
    expect(r.rcaId).toBe('a1');
  });

  it('rejects when from > to', async () => {
    const ctrl = new RcaController(null as any, null as any, null as any);
    await expect(
      ctrl.create({ from: '2026-05-22T00:00:00Z', to: '2026-05-21T00:00:00Z', autoExpand: false }),
    ).rejects.toThrow();
  });
});

describe('RcaController.list', () => {
  it('returns recent rcas from the repo', async () => {
    const ctrl = new RcaController(null as any, null as any, null as any, { list: async () => [{ _id: 'x' }] } as any);
    const r = await ctrl.list();
    expect(r).toHaveLength(1);
  });
});
