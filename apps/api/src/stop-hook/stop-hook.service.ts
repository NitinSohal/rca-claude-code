import { Injectable } from '@nestjs/common';
import { detectMetricBackToBaseline } from '@rca/agent';
import type { GrafanaService } from '../grafana/grafana.service';
import type { RcaOutput } from '@rca/agent';

export interface StopHookConfig {
  confidenceThreshold: number;
  baselineTolerance: number;
  windowMaxHours: number;
}

export interface StopHookRun {
  trigger: 'manual' | 'webhook' | 'health';
  alert_uid?: string;
  alert_query?: string;
}

export interface EvaluateInput {
  rca: RcaOutput;
  run: StopHookRun;
  window: { from: string; to: string };
}

export interface StopDecision {
  stop: boolean;
  reason: 'success' | 'time_capped' | 'not_meaningful_yet' | 'rca_good_but_incident_ongoing';
  details?: Record<string, unknown>;
}

@Injectable()
export class StopHookService {
  constructor(
    private readonly grafana: GrafanaService,
    private readonly cfg: StopHookConfig,
  ) {}

  async evaluate(input: EvaluateInput): Promise<StopDecision> {
    const { rca, run, window } = input;
    const hours = hoursBetween(window.from, window.to);
    if (hours >= this.cfg.windowMaxHours) return { stop: true, reason: 'time_capped' };

    const meaningful =
      rca.root_cause.confidence >= this.cfg.confidenceThreshold && rca.evidence.length > 0;

    if (run.trigger !== 'webhook') {
      return meaningful
        ? { stop: true, reason: 'success' }
        : { stop: false, reason: 'not_meaningful_yet' };
    }

    if (!meaningful) return { stop: false, reason: 'not_meaningful_yet' };

    let alertOk = true;
    let metricBack = true;

    if (run.alert_uid) {
      try {
        const state = await this.grafana.getAlertState(run.alert_uid);
        alertOk = state === 'ok' || state === 'normal' || state === 'inactive';
      } catch {
        alertOk = false;
      }
    }

    if (run.alert_query && alertOk) {
      try {
        const promRes = await this.grafana.queryProm({
          promql: run.alert_query,
          from: shiftMinutes(window.to, -40),
          to: window.to,
          step: '60s',
          maxPoints: 200,
        });
        const points = promRes.points;
        const last5 = points.slice(-5).map(([_, v]) => v);
        const baseline = points.slice(0, -5).map(([_, v]) => v);
        const peak = points.reduce((p, [, v]) => Math.max(p, v), 0);
        const currentAvg = avg(last5);
        const baselineAvg = avg(baseline);
        const r = detectMetricBackToBaseline({
          baselineAvg,
          currentAvg,
          peak,
          tolerance: this.cfg.baselineTolerance,
        });
        metricBack = r.metricBack;
      } catch {
        metricBack = false;
      }
    }

    const spikeOver = alertOk && metricBack;
    if (spikeOver) return { stop: true, reason: 'success' };
    return { stop: false, reason: 'rca_good_but_incident_ongoing', details: { alertOk, metricBack } };
  }
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}
function shiftMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
