import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
