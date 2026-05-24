import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { EventsRepo } from '../src/mongo/events.repo';
import { EventsService } from '../src/events/events.service';

let mongod: MongoMemoryServer;
let client: MongoClient;
let repo: EventsRepo;
let svc: EventsService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});

beforeEach(async () => {
  await client.db('rca').collection('events').deleteMany({});
  repo = new EventsRepo(client.db('rca'));
  svc = new EventsService(repo);
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('EventsService', () => {
  it('records failure as severity=critical for known-critical sources', async () => {
    await svc.recordFailure({
      target: 'grafana',
      operation: 'query_loki',
      error: new Error('500'),
      attempts: 3,
    });
    const open = await repo.listUnacknowledged();
    expect(open[0].severity).toBe('critical');
    expect(open[0].source).toBe('grafana');
  });

  it('records failure as severity=error for slack', async () => {
    await svc.recordFailure({
      target: 'slack',
      operation: 'post_message',
      error: new Error('400'),
      attempts: 1,
    });
    const open = await repo.listUnacknowledged();
    expect(open[0].severity).toBe('error');
  });

  it('on success auto-resolves any unack events for the same source+op', async () => {
    await svc.recordFailure({
      target: 'slack',
      operation: 'post_message',
      error: new Error('fail'),
      attempts: 1,
    });
    expect((await repo.listUnacknowledged()).length).toBe(1);
    await svc.recordSuccess({ target: 'slack', operation: 'post_message' });
    expect((await repo.listUnacknowledged()).length).toBe(0);
  });

  it('respects LOG_SUCCESSES=true by creating an info event', async () => {
    const noisy = new EventsService(repo, { logSuccesses: true });
    await noisy.recordSuccess({ target: 'grafana', operation: 'query_loki' });
    const list = await repo.list({ severity: 'info' });
    expect(list.length).toBe(1);
  });

  it('getCounts returns aggregated unack counts', async () => {
    await svc.recordFailure({ target: 'grafana', operation: 'op-a', error: new Error('x'), attempts: 1 });
    const c = await svc.getCounts();
    expect(c.critical).toBe(1);
  });
});
