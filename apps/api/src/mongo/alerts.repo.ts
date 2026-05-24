import { ObjectId, type Db, type Collection } from 'mongodb';

export interface AlertDoc {
  _id: ObjectId;
  alert_uid: string;
  first_seen_at: Date;
  payload: Record<string, unknown>;
  query: string;
}

export class AlertsRepo {
  private col: Collection<AlertDoc>;
  constructor(db: Db) {
    this.col = db.collection<AlertDoc>('alerts');
  }

  async cache(alertUid: string, payload: Record<string, unknown>, query: string): Promise<void> {
    await this.col.updateOne(
      { alert_uid: alertUid },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          alert_uid: alertUid,
          first_seen_at: new Date(),
        },
        $set: { payload, query },
      },
      { upsert: true },
    );
  }

  async getQuery(alertUid: string): Promise<string | null> {
    const r = await this.col.findOne({ alert_uid: alertUid });
    return r?.query ?? null;
  }
}
