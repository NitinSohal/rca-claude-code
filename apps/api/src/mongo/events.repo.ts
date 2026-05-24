import { ObjectId, type Db, type Collection } from 'mongodb';

export type Severity = 'info' | 'warn' | 'error' | 'critical';
export type EventSource =
  | 'grafana'
  | 'mongo'
  | 'slack'
  | 'anthropic'
  | 'claude_auth'
  | 'webhook'
  | 'infra_md'
  | 'circuit_breaker'
  | 'stop_hook';

export type EventStatus = 'unacknowledged' | 'ignored' | 'resolved';

export interface EventDoc {
  _id: ObjectId;
  created_at: Date;
  severity: Severity;
  source: EventSource;
  operation: string;
  message: string;
  context?: Record<string, unknown>;
  status: EventStatus;
  acknowledged_by?: string | null;
  acknowledged_at?: Date | null;
  resolved_at?: Date | null;
  suggested_fix?: string | null;
}

export class EventsRepo {
  private col: Collection<EventDoc>;
  constructor(db: Db) {
    this.col = db.collection<EventDoc>('events');
  }

  async insert(input: {
    severity: Severity;
    source: EventSource;
    operation: string;
    message: string;
    context?: Record<string, unknown>;
    suggested_fix?: string;
  }): Promise<string> {
    const doc: EventDoc = {
      _id: new ObjectId(),
      created_at: new Date(),
      severity: input.severity,
      source: input.source,
      operation: input.operation,
      message: input.message,
      context: input.context,
      status: 'unacknowledged',
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_at: null,
      suggested_fix: input.suggested_fix ?? null,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async autoResolve(source: EventSource, operation: string): Promise<number> {
    const r = await this.col.updateMany(
      { source, operation, status: 'unacknowledged' },
      { $set: { status: 'resolved', resolved_at: new Date() } },
    );
    return r.modifiedCount;
  }

  async listUnacknowledged(): Promise<EventDoc[]> {
    return this.col.find({ status: 'unacknowledged' }).sort({ created_at: -1 }).toArray();
  }

  async list(filter: { severity?: Severity; source?: EventSource; status?: EventStatus } = {}): Promise<EventDoc[]> {
    return this.col.find(filter).sort({ created_at: -1 }).limit(200).toArray();
  }

  async findById(id: string): Promise<EventDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async acknowledge(id: string, by: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { acknowledged_by: by, acknowledged_at: new Date() } },
    );
  }

  async ignore(id: string): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'ignored' } });
  }

  async resolve(id: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'resolved', resolved_at: new Date() } },
    );
  }

  async countsBySeverity(): Promise<Record<Severity, number>> {
    const out: Record<Severity, number> = { info: 0, warn: 0, error: 0, critical: 0 };
    const rows = await this.col
      .aggregate([
        { $match: { status: 'unacknowledged' } },
        { $group: { _id: '$severity', n: { $sum: 1 } } },
      ])
      .toArray();
    for (const r of rows) out[r._id as Severity] = r.n;
    return out;
  }
}
