import { describe, it, expect, vi } from 'vitest';
import { analyzeHandler } from '../src/cli/analyze.command';

describe('analyzeHandler', () => {
  it('runs an RCA and prints the rcaId', async () => {
    const loop = { runCycle: vi.fn().mockResolvedValue({ runId: 'r1', rcaId: 'a1', iterations: 2, stopReason: 'success' }) };
    const infra = { getComponents: () => [{ name: 'x' }], getProse: () => 'p', getDependencyGraph: () => ({}) };
    const reader = { read: (n: string) => `prompt:${n}` };
    const log = vi.fn();
    await analyzeHandler({
      from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z', autoExpand: false,
    }, { loop: loop as any, infra: infra as any, prompts: reader as any, log });
    expect(loop.runCycle).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('a1'));
  });
});
