import { describe, it, expect } from 'vitest';
import { lttb } from '../src/lttb';

type Pt = [number, number];

describe('lttb', () => {
  it('returns input unchanged when length <= threshold', () => {
    const pts: Pt[] = [[1, 10], [2, 20], [3, 30]];
    expect(lttb(pts, 100)).toEqual(pts);
  });
  it('downsamples to exactly threshold points', () => {
    const pts: Pt[] = Array.from({ length: 1000 }, (_, i) => [i, Math.sin(i / 50)]);
    const out = lttb(pts, 100);
    expect(out.length).toBe(100);
  });
  it('preserves first and last point', () => {
    const pts: Pt[] = Array.from({ length: 500 }, (_, i) => [i, i * 2]);
    const out = lttb(pts, 50);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([499, 998]);
  });
  it('rejects threshold < 3 by returning input', () => {
    const pts: Pt[] = Array.from({ length: 10 }, (_, i) => [i, i]);
    expect(lttb(pts, 2)).toEqual(pts);
  });
});
