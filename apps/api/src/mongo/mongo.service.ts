import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, type Db } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleDestroy {
  private client: MongoClient;
  private readonly dbName: string;

  constructor(uri: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    const parsed = new URL(uri.replace(/^mongodb\+srv:/, 'mongodb:'));
    const path = parsed.pathname.replace('/', '');
    this.dbName = path || 'rca';
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.db('admin').command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  db(): Db {
    return this.client.db(this.dbName);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
