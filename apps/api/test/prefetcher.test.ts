import { describe, it, expect, vi } from 'vitest';
import { Prefetcher } from '../src/coordinator/prefetcher';
import type { Component } from '@rca/agent';

const components: Component[] = [
  {
    name: 'auth-service',
    type: 'service',
    description: 'd',
    loki: { selector: '{service="auth-service"}', error_filter: '|~ "error"' },
    prometheus: { metrics: [{ name: 'rps', query: 'sum(rate(http_requests_total[5m]))' }] },
  } as Component,
];

describe('Prefetcher', () => {
  it('runs loki + each prom metric in parallel and returns aggregated payload', async () => {
    const queryLoki = vi.fn().mockResolvedValue({ lines: [{ ts: '1', line: 'err' }], total_lines: 1 });
    const queryProm = vi.fn().mockResolvedValue({ points: [[1, 10]] });
    const queryCw = vi.fn();
    const pf = new Prefetcher({ queryLoki, queryProm, queryCloudWatch: queryCw } as any, { concurrency: 4 });

    const out = await pf.fetchAll(components, { from: 'a', to: 'b' });

    expect(queryLoki).toHaveBeenCalledTimes(1);
    expect(queryProm).toHaveBeenCalledTimes(1);
    expect(out['auth-service'].loki.error_lines.length).toBe(1);
    expect(out['auth-service'].prometheus.rps).toEqual([[1, 10]]);
  });

  it('records data_unavailable for a component when its grafana call rejects', async () => {
    const queryLoki = vi.fn().mockRejectedValue(new Error('Circuit open'));
    const pf = new Prefetcher(
      { queryLoki, queryProm: vi.fn(), queryCloudWatch: vi.fn() } as any,
      { concurrency: 4 },
    );
    const out = await pf.fetchAll(components, { from: 'a', to: 'b' });
    expect(out['auth-service'].data_unavailable).toBe(true);
  });

  it('caps concurrent in-flight grafana calls at the configured concurrency', async () => {
    let inflight = 0;
    let peak = 0;
    const slow = vi.fn().mockImplementation(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return { lines: [], total_lines: 0 };
    });
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `c${i}` as any,
      type: 'service' as const,
      description: '',
      loki: { selector: '{}' },
    })) as Component[];
    const pf = new Prefetcher(
      { queryLoki: slow, queryProm: vi.fn(), queryCloudWatch: vi.fn() } as any,
      { concurrency: 5 },
    );
    await pf.fetchAll(many, { from: 'a', to: 'b' });
    expect(peak).toBeLessThanOrEqual(5);
  });
});
