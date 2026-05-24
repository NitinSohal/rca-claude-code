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

  async queryProm(input: {
    promql: string;
    from: string;
    to: string;
    step: string;
    maxPoints: number;
  }): Promise<{ points: [number, number][] }> {
    const uid = this.opts.uids.prom;
    if (!uid) throw new Error('No Prometheus datasource UID configured');
    return this.guard.withGuard({ target: 'grafana', operation: 'query_prom' }, async () => {
      const body = new URLSearchParams({
        query: input.promql,
        start: String(Math.floor(new Date(input.from).getTime() / 1000)),
        end: String(Math.floor(new Date(input.to).getTime() / 1000)),
        step: input.step,
      });
      const res = await fetch(
        this.url(`/api/datasources/proxy/uid/${uid}/api/v1/query_range`),
        { method: 'POST', headers: this.headers(), body: body.toString() },
      );
      if (!res.ok) throw new Error(`Prom ${res.status}`);
      const json = (await res.json()) as {
        data?: { result?: Array<{ values?: [number, string][] }> };
      };
      const first = json.data?.result?.[0];
      const raw: [number, number][] = (first?.values ?? []).map(([t, v]) => [t, Number(v)]);
      const { lttb } = await import('@rca/agent');
      return { points: lttb(raw, input.maxPoints) };
    });
  }

  async queryCloudWatch(input: {
    namespace: string;
    dimensions: Record<string, string>;
    metric: string;
    from: string;
    to: string;
    maxPoints: number;
  }): Promise<{ points: [number, number][] }> {
    const uid = this.opts.uids.cw;
    if (!uid) throw new Error('No CloudWatch datasource UID configured');
    return this.guard.withGuard({ target: 'grafana', operation: 'query_cw' }, async () => {
      const body = JSON.stringify({
        queries: [
          {
            refId: 'A',
            namespace: input.namespace,
            metricName: input.metric,
            dimensions: input.dimensions,
            statistic: 'Average',
            period: '60',
          },
        ],
        from: String(new Date(input.from).getTime()),
        to: String(new Date(input.to).getTime()),
      });
      const res = await fetch(
        this.url(`/api/datasources/proxy/uid/${uid}/cloudwatch/metrics/query`),
        { method: 'POST', headers: this.headers(), body },
      );
      if (!res.ok) throw new Error(`CW ${res.status}`);
      const json = (await res.json()) as {
        results?: Record<
          string,
          { frames?: Array<{ data?: { values: number[][] } }> }
        >;
      };
      const frame = json.results?.A?.frames?.[0];
      const vals = frame?.data?.values ?? [];
      const ts = (vals[0] ?? []) as number[];
      const v = (vals[1] ?? []) as number[];
      const raw: [number, number][] = ts.map((t, i) => [t / 1000, v[i] ?? 0]);
      const { lttb } = await import('@rca/agent');
      return { points: lttb(raw, input.maxPoints) };
    });
  }

  async getAlertState(uid: string): Promise<string> {
    return this.guard.withGuard({ target: 'grafana', operation: 'alert_state' }, async () => {
      const res = await fetch(this.url(`/api/v1/provisioning/alert-rules/${uid}`), {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`AlertState ${res.status}`);
      const json = (await res.json()) as { state?: string };
      return json.state ?? 'unknown';
    });
  }
}
