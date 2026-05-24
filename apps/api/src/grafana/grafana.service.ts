import { Injectable } from '@nestjs/common';
import { OutboundCallGuard } from '../guard/outbound-call-guard';

export interface GrafanaServiceOpts {
  baseUrl: string;
  token: string;
  uids: { loki?: string; prom?: string; cw?: string };
}

export interface LokiQueryInput {
  logql: string;
  from: string;
  to: string;
  limit: number;
}

export interface LokiLine {
  ts: string;
  line: string;
}

export interface LokiResult {
  lines: LokiLine[];
  total_lines: number;
}

const MAX_LINE_BYTES = 1024;

function truncate(s: string): string {
  return s.length > MAX_LINE_BYTES ? s.slice(0, MAX_LINE_BYTES) : s;
}

@Injectable()
export class GrafanaService {
  constructor(
    private readonly opts: GrafanaServiceOpts,
    private readonly guard: OutboundCallGuard,
  ) {}

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/json' };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/api/health'), { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  async queryLoki(input: LokiQueryInput): Promise<LokiResult> {
    const uid = this.opts.uids.loki;
    if (!uid) throw new Error('No Loki datasource UID configured');
    return this.guard.withGuard(
      { target: 'grafana', operation: 'query_loki' },
      async () => {
        const body = new URLSearchParams({
          query: input.logql,
          start: new Date(input.from).getTime() * 1_000_000 + '',
          end: new Date(input.to).getTime() * 1_000_000 + '',
          limit: String(input.limit),
        });
        const res = await fetch(
          this.url(`/api/datasources/proxy/uid/${uid}/loki/api/v1/query_range`),
          { method: 'POST', headers: this.headers(), body: body.toString() },
        );
        if (!res.ok) throw new Error(`Loki ${res.status}`);
        const json = (await res.json()) as {
          data?: { result?: Array<{ values?: [string, string][] }> };
        };
        const result = json.data?.result ?? [];
        const flat: LokiLine[] = [];
        for (const s of result) {
          for (const [ts, line] of s.values ?? []) {
            flat.push({ ts, line: truncate(line) });
            if (flat.length >= input.limit) break;
          }
          if (flat.length >= input.limit) break;
        }
        return { lines: flat, total_lines: flat.length };
      },
    );
  }
}
