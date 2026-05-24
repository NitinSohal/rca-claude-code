import { describe, it, expect } from 'vitest';
import { detectMetricBackToBaseline } from '../src/baseline';

describe('detectMetricBackToBaseline', () => {
  const tolerance = 0.2;
  it('relative mode: current within tolerance of baseline → true', () => {
    const r = detectMetricBackToBaseline({ baselineAvg: 100, currentAvg: 110, peak: 800, tolerance });
    expect(r.metricBack).toBe(true);
    expect(r.mode).toBe('relative');
  });
  it('relative mode: current way over baseline → false', () => {
    const r = detectMetricBackToBaseline({ baselineAvg: 100, currentAvg: 400, peak: 800, tolerance });
    expect(r.metricBack).toBe(false);
  });
  it('absolute mode triggers when baseline is < 5% of peak', () => {
    const r = detectMetricBackToBaseline({ baselineAvg: 0, currentAvg: 5, peak: 1000, tolerance });
    expect(r.mode).toBe('absolute');
    expect(r.metricBack).toBe(true);
  });
  it('absolute mode: current >= 1% of peak → false', () => {
    const r = detectMetricBackToBaseline({ baselineAvg: 0, currentAvg: 50, peak: 1000, tolerance });
    expect(r.mode).toBe('absolute');
    expect(r.metricBack).toBe(false);
  });
  it('peak == 0 (no signal at all) → metricBack=true', () => {
    const r = detectMetricBackToBaseline({ baselineAvg: 0, currentAvg: 0, peak: 0, tolerance });
    expect(r.metricBack).toBe(true);
  });
});
