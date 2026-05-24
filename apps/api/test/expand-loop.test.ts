import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { ExpandLoopService } from '../src/expand-loop/expand-loop.service';
import { StubClaudeClient } from '@rca/agent';
import { CoordinatorService } from '../src/coordinator/coordinator.service';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { Prefetcher } from '../src/coordinator/prefetcher';
import { RunStreamBus } from '../src/coordinator/stream';
import { DependencyBus } from '../src/coordinator/dependency-bus';
import { SynthesizerService } from '../src/synthesizer/synthesizer.service';
import { StopHookService } from '../src/stop-hook/stop-hook.service';
import { PastRcaLookup } from '../src/synthesizer/past-rca-lookup';
import { SlackService } from '../src/slack/slack.service';
import { RunsRepo } from '../src/mongo/runs.repo';
import { RcasRepo } from '../src/mongo/rcas.repo';
import { ResolutionsRepo } from '../src/mongo/resolutions.repo';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';
import { EventsService } from '../src/events/events.service';
import { EventsRepo } from '../src/mongo/events.repo';

const sink = { recordFailure: async () => {}, recordSuccess: async () => {} };
const fakeGrafana = {
  queryLoki: vi.fn().mockResolvedValue({ lines: [], total_lines: 0 }),
  queryProm: vi.fn().mockResolvedValue({ points: [] }),
  queryCloudWatch: vi.fn(),
  getAlertState: vi.fn(),
} as any;

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});
beforeEach(async () => {
  await client.db('rca').dropDatabase();
});
afterAll(async () => {
  await client.close();
  await mongod.stop();
});

const components = [{ name: 'a', type: 'service' as const, description: 'A', loki: { selector: '{a}' } }];

function makeSubagent(status: any, confidence: number) {
  return new StubClaudeClient({
    'a-investigator': () => ({
      component: 'a', status, confidence, findings: [], suspected_dependencies: [], notes: '',
    }),
    synthesizer: () => ({
      summary: 's',
      root_cause: { component: 'a', description: 'd', confidence },
      contributing_factors: [], timeline: [],
      evidence: confidence >= 0.75 ? [{ component: 'a', type: 'log' as const, ref: 'r', excerpt: 'e' }] : [],
      suggested_next_steps: [], similar_past_rcas: [],
    }),
  });
}

function makeService(stub: StubClaudeClient) {
  const db = client.db('rca');
  const eventsRepo = new EventsRepo(db);
  const events = new EventsService(eventsRepo);
  const guard = new OutboundCallGuard(events);
  const coord = new CoordinatorService(
    new SubagentRunner(stub, { timeoutMs: 200 }),
    new Prefetcher(fakeGrafana, { concurrency: 4 }),
    new RunStreamBus(),
    new DependencyBus(),
  );
  const synth = new SynthesizerService(stub);
  const stop = new StopHookService(fakeGrafana, {
    confidenceThreshold: 0.75, baselineTolerance: 0.2, windowMaxHours: 24,
  });
  const past = new PastRcaLookup(new RcasRepo(db), new ResolutionsRepo(db));
  const slack = new SlackService('', guard);
  return new ExpandLoopService(
    coord, synth, stop, past, slack,
    new RunsRepo(db), new RcasRepo(db), new RunStreamBus(),
    { windowStepMinutes: 30, windowMaxHours: 24, backoffMs: 1, dashboardBaseUrl: 'http://x' },
  );
}

describe('ExpandLoopService.runCycle', () => {
  it('terminates after iteration 1 when manual run is confident + evidenced', async () => {
    const svc = makeService(makeSubagent('healthy', 0.9));
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components,
      promptMdByComponent: { a: 'prompt' },
      infraMd: 'infra',
      dependencyGraph: {},
      autoExpand: true,
    });
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe('success');
  });

  it('expands window backward by step when not meaningful', async () => {
    let calls = 0;
    const stub = new StubClaudeClient({
      'a-investigator': () => ({
        component: 'a', status: 'healthy', confidence: 0.9, findings: [], suspected_dependencies: [], notes: '',
      }),
      synthesizer: () => {
        calls++;
        return {
          summary: 's',
          root_cause: { component: 'a', description: 'd', confidence: calls < 3 ? 0.3 : 0.9 },
          contributing_factors: [], timeline: [],
          evidence: calls < 3 ? [] : [{ component: 'a', type: 'log' as const, ref: 'r', excerpt: 'e' }],
          suggested_next_steps: [], similar_past_rcas: [],
        };
      },
    });
    const svc = makeService(stub);
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components, promptMdByComponent: { a: 'prompt' }, infraMd: 'infra', dependencyGraph: {}, autoExpand: true,
    });
    expect(result.iterations).toBe(3);
  });

  it('respects autoExpand=false: returns after iteration 1 even when not meaningful', async () => {
    const svc = makeService(makeSubagent('inconclusive', 0.2));
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components, promptMdByComponent: { a: 'prompt' }, infraMd: 'infra', dependencyGraph: {}, autoExpand: false,
    });
    expect(result.iterations).toBe(1);
  });
});
