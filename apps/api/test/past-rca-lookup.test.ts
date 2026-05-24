import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { RcasRepo } from '../src/mongo/rcas.repo';
import { ResolutionsRepo } from '../src/mongo/resolutions.repo';
import { PastRcaLookup } from '../src/synthesizer/past-rca-lookup';

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});

beforeEach(async () => {
  await client.db('rca').collection('rcas').deleteMany({});
  await client.db('rca').collection('resolutions').deleteMany({});
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('PastRcaLookup', () => {
  it('returns up to 3 resolved RCAs per component, top by recency, deduped', async () => {
    const rcas = new RcasRepo(client.db('rca'));
    const lookup = new PastRcaLookup(rcas, new ResolutionsRepo(client.db('rca')));

    for (let i = 0; i < 5; i++) {
      const id = await rcas.create({
        runId: new ObjectId().toHexString(),
        window: { from: 'a', to: 'b' },
        rca: {
          summary: `r${i}`,
          root_cause: { component: 'postgres-primary', description: '', confidence: 0.9 },
          contributing_factors: [],
          timeline: [],
          evidence: [],
          suggested_next_steps: [],
          similar_past_rcas: [],
        },
      });
      await rcas.markResolved(id, `note ${i}`, [`step ${i}`]);
    }

    const r = await lookup.fetch(['postgres-primary']);
    expect(r.length).toBe(3);
    expect(r.every((p) => p.resolution_note)).toBe(true);
  });

  it('returns empty when no past RCAs match', async () => {
    const lookup = new PastRcaLookup(
      new RcasRepo(client.db('rca')),
      new ResolutionsRepo(client.db('rca')),
    );
    expect(await lookup.fetch(['nothing'])).toEqual([]);
  });
});
