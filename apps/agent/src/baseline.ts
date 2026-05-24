export interface BaselineInput {
  baselineAvg: number;
  currentAvg: number;
  peak: number;
  tolerance: number;
}

export interface BaselineResult {
  metricBack: boolean;
  mode: 'relative' | 'absolute';
  ratio: number;
}

export function detectMetricBackToBaseline(input: BaselineInput): BaselineResult {
  const { baselineAvg, currentAvg, peak, tolerance } = input;

  if (peak === 0) return { metricBack: true, mode: 'absolute', ratio: 0 };

  const useRelative = baselineAvg > 0.05 * peak;
  if (useRelative) {
    const ratio = Math.abs(currentAvg - baselineAvg) / baselineAvg;
    return { metricBack: ratio <= tolerance, mode: 'relative', ratio };
  }

  const ratio = peak === 0 ? 0 : currentAvg / peak;
  return { metricBack: ratio < 0.01, mode: 'absolute', ratio };
}
