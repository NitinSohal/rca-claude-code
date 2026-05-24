import { ObjectId, type Db, type Collection } from 'mongodb';

export type Trigger = 'manual' | 'webhook' | 'health';
export type RunStatus = 'running' | 'completed' | 'degraded' | 'failed';

export interface RunDoc {
  _id: ObjectId;
  started_at: Date;
  ended_at?: Date;
  trigger: Trigger;
  window: { from: string; to: string };
  current_window?: { from: string; to: string };
  iteration: number;
  status: RunStatus;
  stop_reason?: string;
  alert_uid?: string;
  alert_query?: string;
  rca_id?: ObjectId;
  tokens?: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
}

export class RunsRepo {
  private col: Collection<RunDoc>;
  constructor(db: Db) {
    this.col = db.collection<RunDoc>('runs');
  }

  async create(input: {
    trigger: Trigger;
    window: { from: string; to: string };
    alert_uid?: string;
    alert_query?: string;
  }): Promise<string> {
    const doc: RunDoc = {
      _id: new ObjectId(),
      started_at: new Date(),
      trigger: input.trigger,
      window: input.window,
      current_window: input.window,
      iteration: 0,
      status: 'running',
      alert_uid: input.alert_uid,
      alert_query: input.alert_query,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findById(id: string): Promise<RunDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async bumpIteration(id: string, window: { from: string; to: string }): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { iteration: 1 }, $set: { current_window: window } },
    );
  }

  async finalize(id: string, status: RunStatus, stop_reason: string, rcaId?: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          stop_reason,
          ended_at: new Date(),
          ...(rcaId ? { rca_id: new ObjectId(rcaId) } : {}),
        },
      },
    );
  }

  async recordTokens(id: string, tokens: NonNullable<RunDoc['tokens']>): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { tokens } });
  }
}
