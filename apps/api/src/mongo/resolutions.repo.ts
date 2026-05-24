import { ObjectId, type Db, type Collection } from 'mongodb';

export interface ResolutionDoc {
  _id: ObjectId;
  rca_id: ObjectId;
  created_at: Date;
  note: string;
  steps: string[];
}

export class ResolutionsRepo {
  private col: Collection<ResolutionDoc>;
  constructor(db: Db) {
    this.col = db.collection<ResolutionDoc>('resolutions');
  }

  async create(rcaId: string, note: string, steps: string[]): Promise<string> {
    const doc: ResolutionDoc = {
      _id: new ObjectId(),
      rca_id: new ObjectId(rcaId),
      created_at: new Date(),
      note,
      steps,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findByRcaId(rcaId: string): Promise<ResolutionDoc | null> {
    return this.col.findOne({ rca_id: new ObjectId(rcaId) });
  }
}
