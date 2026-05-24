import { describe, it, expect } from 'vitest';
import { HealthController } from '../src/health/health.controller';

describe('HealthController', () => {
  it('reports infra loaded + dependencies stub OK before mongo/grafana wired in', async () => {
    const ctrl = new HealthController(
      { ping: async () => true } as any,
      { ping: async () => true } as any,
      { checkAuth: async () => true } as any,
      { getCounts: () => ({ critical: 0, error: 0, warn: 1 }) } as any,
      { getComponents: () => [{ name: 'x' }] } as any,
    );
    const r = await ctrl.healthz();
    expect(r.status).toBe('ok');
    expect(r.unacknowledged_events).toEqual({ critical: 0, error: 0, warn: 1 });
  });
  it('reports degraded status when any dependency is down', async () => {
    const ctrl = new HealthController(
      { ping: async () => false } as any,
      { ping: async () => true } as any,
      { checkAuth: async () => true } as any,
      { getCounts: () => ({ critical: 0, error: 0, warn: 0 }) } as any,
      { getComponents: () => [{ name: 'x' }] } as any,
    );
    const r = await ctrl.healthz();
    expect(r.status).toBe('degraded');
    expect(r.grafana).toBe(false);
  });
});
