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
