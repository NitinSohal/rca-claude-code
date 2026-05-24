import { describe, it, expect, vi } from 'vitest';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

const noopSink = { recordFailure: vi.fn().mockResolvedValue(undefined), recordSuccess: vi.fn().mockResolvedValue(undefined) };

describe('OutboundCallGuard.withGuard', () => {
  it('returns the inner result on first-try success', async () => {
    const g = new OutboundCallGuard(noopSink);
    const r = await g.withGuard({ target: 'grafana', operation: 'query_loki' }, async () => 42);
    expect(r).toBe(42);
  });

  it('retries on retriable failure', async () => {
    const g = new OutboundCallGuard(noopSink);
    let attempts = 0;
    const r = await g.withGuard(
      { target: 'grafana', operation: 'query_loki', retries: 2, baseDelayMs: 1 },
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('boom');
        return 'ok';
      },
    );
    expect(r).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('records a failure event when retries are exhausted', async () => {
    const sink = { recordFailure: vi.fn().mockResolvedValue(undefined), recordSuccess: vi.fn().mockResolvedValue(undefined) };
    const g = new OutboundCallGuard(sink);
    await expect(
      g.withGuard({ target: 'grafana', operation: 'query_loki', retries: 1, baseDelayMs: 1 }, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(sink.recordFailure).toHaveBeenCalled();
  });

  it('refuses to call when breaker is open', async () => {
    const g = new OutboundCallGuard(noopSink);
    // force-open
    for (let i = 0; i < 5; i++) {
      await g.withGuard({ target: 'grafana', operation: 'op-open', retries: 0, baseDelayMs: 0 }, async () => {
        throw new Error('boom');
      }).catch(() => {});
    }
    await expect(
      g.withGuard({ target: 'grafana', operation: 'op-open' }, async () => 'ok'),
    ).rejects.toThrow(/circuit open/i);
  });
});
