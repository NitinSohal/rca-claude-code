import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoService } from '../src/mongo/mongo.service';

let mongod: MongoMemoryServer;
let svc: MongoService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  svc = new MongoService(mongod.getUri());
  await svc.connect();
});

afterAll(async () => {
  await svc.close();
  await mongod.stop();
});

describe('MongoService', () => {
  it('ping returns true after connect', async () => {
    expect(await svc.ping()).toBe(true);
  });

  it('db() returns a Db with the rca database', () => {
    expect(svc.db().databaseName).toBe('rca');
  });
});

import { RunsRepo } from '../src/mongo/runs.repo';

describe('RunsRepo', () => {
  it('creates a new run document and increments iteration', async () => {
    const repo = new RunsRepo(svc.db());
    const id = await repo.create({
      trigger: 'manual',
      window: { from: '2026-05-22T00:00:00Z', to: '2026-05-22T04:00:00Z' },
    });
    const run = await repo.findById(id);
    expect(run?.status).toBe('running');
    expect(run?.iteration).toBe(0);

    await repo.bumpIteration(id, { from: '2026-05-21T22:00:00Z', to: '2026-05-22T04:00:00Z' });
    const r2 = await repo.findById(id);
    expect(r2?.iteration).toBe(1);
    expect(r2?.current_window?.from).toBe('2026-05-21T22:00:00Z');
  });

  it('finalize sets status and end_time', async () => {
    const repo = new RunsRepo(svc.db());
    const id = await repo.create({
      trigger: 'manual',
      window: { from: 'a', to: 'b' },
    });
    await repo.finalize(id, 'completed', 'success');
    const run = await repo.findById(id);
    expect(run?.status).toBe('completed');
    expect(run?.stop_reason).toBe('success');
    expect(run?.ended_at).toBeTruthy();
  });
});

import { RcasRepo } from '../src/mongo/rcas.repo';

describe('RcasRepo', () => {
  it('persists and reads back an RCA, status defaults to "open"', async () => {
    const repo = new RcasRepo(svc.db());
    const id = await repo.create({
      runId: new ObjectId().toHexString(),
      window: { from: 'a', to: 'b' },
      rca: {
        summary: 's',
        root_cause: { component: 'postgres-primary', description: 'd', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: [],
        similar_past_rcas: [],
      },
    });
    const out = await repo.findById(id);
    expect(out?.status).toBe('open');
    expect(out?.rca.root_cause.component).toBe('postgres-primary');
  });

  it('findRecentByComponent returns up to 3 resolved RCAs', async () => {
    const repo = new RcasRepo(svc.db());
    for (let i = 0; i < 5; i++) {
      const id = await repo.create({
        runId: new ObjectId().toHexString(),
        window: { from: 'a', to: 'b' },
        rca: {
          summary: `r${i}`,
          root_cause: { component: 'x-service', description: '', confidence: 0.8 },
          contributing_factors: [],
          timeline: [],
          evidence: [],
          suggested_next_steps: [],
          similar_past_rcas: [],
        },
      });
      if (i < 4) await repo.markResolved(id, 'note');
    }
    const recent = await repo.findRecentResolvedByComponent('x-service', 3);
    expect(recent).toHaveLength(3);
  });
});

import { EventsRepo } from '../src/mongo/events.repo';

describe('EventsRepo', () => {
  it('inserts an event and auto-resolves prior unack events for same source+op', async () => {
    const repo = new EventsRepo(svc.db());
    await repo.insert({
      severity: 'critical',
      source: 'slack',
      operation: 'post_message',
      message: 'fail 1',
    });
    await repo.insert({
      severity: 'critical',
      source: 'slack',
      operation: 'post_message',
      message: 'fail 2',
    });
    const open = await repo.listUnacknowledged();
    expect(open.length).toBe(2);

    await repo.autoResolve('slack', 'post_message');
    const after = await repo.listUnacknowledged();
    expect(after.length).toBe(0);
  });

  it('counts by severity', async () => {
    const repo = new EventsRepo(svc.db());
    await repo.insert({ severity: 'warn', source: 'grafana', operation: 'op-a', message: 'x' });
    const counts = await repo.countsBySeverity();
    expect(counts.warn).toBeGreaterThanOrEqual(1);
  });
});
