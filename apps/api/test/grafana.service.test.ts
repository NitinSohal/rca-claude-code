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
