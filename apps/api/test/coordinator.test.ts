import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinatorService } from '../src/coordinator/coordinator.service';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { Prefetcher } from '../src/coordinator/prefetcher';
import { RunStreamBus } from '../src/coordinator/stream';
import { DependencyBus } from '../src/coordinator/dependency-bus';
import { StubClaudeClient } from '@rca/agent';

const components = [
  {
    name: 'a',
    type: 'service' as const,
    description: 'A',
    loki: { selector: '{a}' },
  },
  {
    name: 'b',
    type: 'service' as const,
    description: 'B',
    loki: { selector: '{b}' },
  },
];

function makeStub(map: Record<string, any>) {
  const responders: Record<string, any> = {};
  for (const k of Object.keys(map)) {
    responders[`${k}-investigator`] = () => map[k];
  }
  return new StubClaudeClient(responders);
}

const fakeGrafana = {
  queryLoki: vi.fn().mockResolvedValue({ lines: [], total_lines: 0 }),
  queryProm: vi.fn().mockResolvedValue({ points: [] }),
  queryCloudWatch: vi.fn(),
} as any;

describe('CoordinatorService.runOneIteration', () => {
  let coord: CoordinatorService;
  let bus: RunStreamBus;
  beforeEach(() => {
    bus = new RunStreamBus();
  });

  it('runs all subagents and returns their outputs', async () => {
    const stub = makeStub({
      a: { component: 'a', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
      b: { component: 'b', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
    });
    const runner = new SubagentRunner(stub, { timeoutMs: 200 });
    coord = new CoordinatorService(
      runner,
      new Prefetcher(fakeGrafana, { concurrency: 4 }),
      bus,
      new DependencyBus(),
    );
    const r = await coord.runOneIteration({
      runId: 'r1',
      components,
      promptMdByComponent: { a: 'prompt-a', b: 'prompt-b' },
      window: { from: 'a', to: 'b' },
    });
    expect(r.outputs).toHaveLength(2);
    expect(r.outputs.every((o) => o.status === 'healthy')).toBe(true);
  });

  it('emits SSE events: iteration_start, subagent_done x N, prefetch_done', async () => {
    const stub = makeStub({
      a: { component: 'a', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
      b: { component: 'b', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
    });
    const runner = new SubagentRunner(stub, { timeoutMs: 200 });
    const events: string[] = [];
    bus.subscribe('r2', (m) => events.push(m.event));
    coord = new CoordinatorService(
      runner,
      new Prefetcher(fakeGrafana, { concurrency: 4 }),
      bus,
      new DependencyBus(),
    );
    await coord.runOneIteration({
      runId: 'r2',
      components,
      promptMdByComponent: { a: 'prompt-a', b: 'prompt-b' },
      window: { from: 'a', to: 'b' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toContain('iteration_start');
    expect(events).toContain('prefetch_done');
    expect(events.filter((e) => e === 'subagent_done')).toHaveLength(2);
  });

  it('quorumMet returns true when >= 6 of 9 are usable', async () => {
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      component: `c${i}`,
      status: i < 6 ? 'healthy' : 'inconclusive',
      confidence: i < 6 ? 0.8 : 0,
      findings: [],
      suspected_dependencies: [],
      notes: '',
    }));
    expect(CoordinatorService.quorumMet(outputs as any, 9, 6)).toBe(true);
  });

  it('quorumMet returns false when too many are inconclusive', async () => {
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      component: `c${i}`,
      status: i < 5 ? 'healthy' : 'inconclusive',
      confidence: i < 5 ? 0.8 : 0,
      findings: [],
      suspected_dependencies: [],
      notes: '',
    }));
    expect(CoordinatorService.quorumMet(outputs as any, 9, 6)).toBe(false);
  });
});
