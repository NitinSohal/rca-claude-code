import { ObjectId, type Db, type Collection } from 'mongodb';
import type { RcaOutput } from '@rca/agent';

export type RcaStatus = 'open' | 'resolved' | 'ignored';

export interface RcaDoc {
  _id: ObjectId;
  run_id: ObjectId;
  created_at: Date;
  window: { from: string; to: string };
  rca: RcaOutput;
  status: RcaStatus;
  resolution_note?: string;
  resolution_steps?: string[];
  resolved_at?: Date;
}

export class RcasRepo {
  private col: Collection<RcaDoc>;
  constructor(db: Db) {
    this.col = db.collection<RcaDoc>('rcas');
  }

  async create(input: {
    runId: string;
    window: { from: string; to: string };
    rca: RcaOutput;
  }): Promise<string> {
    const doc: RcaDoc = {
      _id: new ObjectId(),
      run_id: new ObjectId(input.runId),
      created_at: new Date(),
      window: input.window,
      rca: input.rca,
      status: 'open',
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findById(id: string): Promise<RcaDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async findRecentResolvedByComponent(component: string, limit: number): Promise<RcaDoc[]> {
    return this.col
      .find({ 'rca.root_cause.component': component, status: 'resolved' })
      .sort({ resolved_at: -1 })
      .limit(limit)
      .toArray();
  }

  async list(limit = 50): Promise<RcaDoc[]> {
    return this.col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
  }

  async markResolved(id: string, note: string, steps: string[] = []): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'resolved', resolution_note: note, resolution_steps: steps, resolved_at: new Date() } },
    );
  }

  async markIgnored(id: string): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'ignored' } });
  }
}
