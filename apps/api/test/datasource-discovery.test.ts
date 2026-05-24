import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { discoverDatasources } from '../src/grafana/datasource-discovery';

afterEach(() => nock.cleanAll());

describe('discoverDatasources', () => {
  it('picks first match by type for loki, prometheus, cloudwatch', async () => {
    nock('https://g')
      .get('/api/datasources')
      .reply(200, [
        { uid: 'p1', type: 'prometheus', name: 'Prom A' },
        { uid: 'l1', type: 'loki', name: 'Loki' },
        { uid: 'c1', type: 'cloudwatch', name: 'CW' },
      ]);
    const r = await discoverDatasources({ baseUrl: 'https://g', token: 't' });
    expect(r).toEqual({ loki: 'l1', prom: 'p1', cw: 'c1' });
  });

  it('returns undefined for missing types', async () => {
    nock('https://g')
      .get('/api/datasources')
      .reply(200, [{ uid: 'l1', type: 'loki', name: 'Loki' }]);
    const r = await discoverDatasources({ baseUrl: 'https://g', token: 't' });
    expect(r.loki).toBe('l1');
    expect(r.prom).toBeUndefined();
    expect(r.cw).toBeUndefined();
  });

  it('passes bearer token in Authorization header', async () => {
    const scope = nock('https://g', {
      reqheaders: { authorization: 'Bearer tok' },
    })
      .get('/api/datasources')
      .reply(200, []);
    await discoverDatasources({ baseUrl: 'https://g', token: 'tok' });
    expect(scope.isDone()).toBe(true);
  });
});
