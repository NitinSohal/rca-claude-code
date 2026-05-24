import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GrafanaService } from '../src/grafana/grafana.service';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

const sink = {
  recordFailure: async () => {},
  recordSuccess: async () => {},
};

const lokiFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/loki-error-window.json'), 'utf8'),
);

afterEach(() => nock.cleanAll());

describe('GrafanaService.queryLoki', () => {
  let svc: GrafanaService;
  beforeEach(() => {
    svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l-uid', prom: 'p-uid', cw: 'c-uid' } },
      new OutboundCallGuard(sink),
    );
  });

  it('POSTs to /api/datasources/proxy/uid/<uid>/loki/api/v1/query_range with bearer', async () => {
    const scope = nock('https://g', {
      reqheaders: { authorization: 'Bearer t' },
    })
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, lokiFixture);

    const r = await svc.queryLoki({
      logql: '{service="auth-service"} |~ "error"',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      limit: 500,
    });
    expect(scope.isDone()).toBe(true);
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].line).toContain('connection refused');
  });

  it('truncates lines to 1KB and respects limit', async () => {
    const huge = 'x'.repeat(5000);
    nock('https://g')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, {
        status: 'success',
        data: {
          result: [{ stream: {}, values: [['1', huge], ['2', 'short']] }],
        },
      });
    const r = await svc.queryLoki({
      logql: '{}',
      from: 'a',
      to: 'b',
      limit: 500,
    });
    expect(r.lines[0].line.length).toBeLessThanOrEqual(1024);
    expect(r.lines[1].line).toBe('short');
  });

  it('retries on 5xx', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(500, 'oops')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, lokiFixture);
    const r = await svc.queryLoki({ logql: '{}', from: 'a', to: 'b', limit: 500 });
    expect(r.lines.length).toBe(2);
  });
});

const promFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/prom-rate.json'), 'utf8'),
);
const cwFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/cw-cpu.json'), 'utf8'),
);

describe('GrafanaService.queryProm', () => {
  it('returns [ts, value] tuples and downsamples to limit', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/p-uid/api/v1/query_range')
      .reply(200, promFixture);
    const svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l', prom: 'p-uid', cw: 'c' } },
      new OutboundCallGuard(sink),
    );
    const r = await svc.queryProm({
      promql: 'sum(rate(x[5m]))',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      step: '15s',
      maxPoints: 100,
    });
    expect(r.points.length).toBe(3);
    expect(r.points[0]).toEqual([1716364800, 10.5]);
  });
});

describe('GrafanaService.queryCloudWatch', () => {
  it('parses the dataframe response shape', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/c-uid/cloudwatch/metrics/query')
      .reply(200, cwFixture);
    const svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l', prom: 'p', cw: 'c-uid' } },
      new OutboundCallGuard(sink),
    );
    const r = await svc.queryCloudWatch({
      namespace: 'AWS/ECS',
      dimensions: { ClusterName: 'prod', ServiceName: 'auth' },
      metric: 'CPUUtilization',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      maxPoints: 100,
    });
    expect(r.points.length).toBe(3);
    expect(r.points[0][1]).toBe(42.1);
  });
});
