import { describe, it, expect, vi } from 'vitest';
import { WebhookController } from '../src/webhook/webhook.controller';

const samplePayload = {
  status: 'firing',
  alerts: [
    {
      labels: { __alert_rule_uid__: 'rule-1', alertname: 'high-latency' },
      annotations: { description: 'p95 over 2s' },
      startsAt: '2026-05-22T09:00:00Z',
      valueString: '[ var=A query=sum(rate(http_requests_total[5m])) value=42 ]',
    },
  ],
};

describe('WebhookController.receive', () => {
  it('parses alert payload, caches alert metadata, and triggers ExpandLoop with trigger=webhook', async () => {
    const loop = { runCycle: vi.fn().mockResolvedValue({ runId: 'r1' }) };
    const alerts = { cache: vi.fn().mockResolvedValue(undefined) };
    const infra = {
      getComponents: () => [{ name: 'x' }],
      getProse: () => 'prose',
      getDependencyGraph: () => ({}),
    };
    const prompts = { read: () => 'p' };
    const ctrl = new WebhookController(loop as any, alerts as any, infra as any, prompts as any);
    const r = await ctrl.receive(samplePayload as any);
    expect(loop.runCycle).toHaveBeenCalled();
    expect(loop.runCycle.mock.calls[0][0].trigger).toBe('webhook');
    expect(loop.runCycle.mock.calls[0][0].alert_uid).toBe('rule-1');
    expect(alerts.cache).toHaveBeenCalled();
    expect(r.runId).toBe('r1');
  });

  it('returns 200 and ignores resolved alerts', async () => {
    const loop = { runCycle: vi.fn() };
    const alerts = { cache: vi.fn() };
    const ctrl = new WebhookController(loop as any, alerts as any, null as any, null as any);
    const r = await ctrl.receive({ status: 'resolved', alerts: [] } as any);
    expect(loop.runCycle).not.toHaveBeenCalled();
    expect(r.ignored).toBe(true);
  });
});
