import { describe, it, expect, vi } from 'vitest';
import { StopHookService } from '../src/stop-hook/stop-hook.service';

function rca(confidence: number, evidence: any[] = []) {
  return {
    summary: 's',
    root_cause: { component: 'c', description: '', confidence },
    contributing_factors: [],
    timeline: [],
    evidence,
    suggested_next_steps: [],
    similar_past_rcas: [],
  };
}

describe('StopHookService.evaluate', () => {
  const window24h = { from: '2026-05-21T00:00:00Z', to: '2026-05-22T00:00:00Z' };
  const window4h = { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' };
  const cfg = { confidenceThreshold: 0.75, baselineTolerance: 0.2, windowMaxHours: 24 };

  const fakeGrafana: any = {
    getAlertState: vi.fn(),
    queryProm: vi.fn().mockResolvedValue({ points: [[1, 0]] }),
  };

  it('time_capped at window cap regardless of confidence', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.9, [{}]), run: { trigger: 'manual' } as any, window: window24h });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('time_capped');
  });

  it('manual + confident + evidenced → stop success', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.9, [{}]), run: { trigger: 'manual' } as any, window: window4h });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('success');
  });

  it('low confidence → not meaningful yet', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.3, []), run: { trigger: 'manual' } as any, window: window4h });
    expect(r.stop).toBe(false);
  });

  it('confident + alert state firing → ongoing', async () => {
    fakeGrafana.getAlertState.mockResolvedValue('alerting');
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({
      rca: rca(0.9, [{}]),
      run: { trigger: 'webhook', alert_uid: 'u-1', alert_query: 'sum(rate(x[5m]))' } as any,
      window: window4h,
    });
    expect(r.stop).toBe(false);
    expect(r.reason).toBe('rca_good_but_incident_ongoing');
  });
});
