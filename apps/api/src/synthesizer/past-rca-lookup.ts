import { Injectable } from '@nestjs/common';
import type { PastRcaSummary } from '@rca/agent';
import { RcasRepo } from '../mongo/rcas.repo';
import { ResolutionsRepo } from '../mongo/resolutions.repo';

@Injectable()
export class PastRcaLookup {
  constructor(
    private readonly rcas: RcasRepo,
    private readonly resolutions: ResolutionsRepo,
  ) {}

  async fetch(components: string[]): Promise<PastRcaSummary[]> {
    const seen = new Set<string>();
    const all: { id: string; createdAt: Date; summary: string; rcaId: string }[] = [];

    for (const c of components) {
      const recent = await this.rcas.findRecentResolvedByComponent(c, 3);
      for (const r of recent) {
        const id = r._id.toHexString();
        if (seen.has(id)) continue;
        seen.add(id);
        all.push({ id, createdAt: r.resolved_at ?? r.created_at, summary: r.rca.summary, rcaId: id });
      }
    }
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const top3 = all.slice(0, 3);
    const out: PastRcaSummary[] = [];
    for (const p of top3) {
      const res = await this.resolutions.findByRcaId(p.rcaId);
      const doc = await this.rcas.findById(p.rcaId);
      out.push({
        id: p.id,
        summary: p.summary,
        resolution_note: res?.note ?? doc?.resolution_note,
        resolution_steps: res?.steps ?? doc?.resolution_steps,
      });
    }
    return out;
  }
}
