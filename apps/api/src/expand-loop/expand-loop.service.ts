import { Injectable } from '@nestjs/common';
import type { Component, RcaOutput } from '@rca/agent';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SynthesizerService } from '../synthesizer/synthesizer.service';
import { StopHookService, type StopDecision } from '../stop-hook/stop-hook.service';
import { PastRcaLookup } from '../synthesizer/past-rca-lookup';
import { SlackService } from '../slack/slack.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RcasRepo } from '../mongo/rcas.repo';
import { RunStreamBus } from '../coordinator/stream';

export interface RunCycleInput {
  trigger: 'manual' | 'webhook' | 'health';
  window: { from: string; to: string };
  components: Component[];
  promptMdByComponent: Record<string, string>;
  infraMd: string;
  dependencyGraph: Record<string, string[]>;
  autoExpand: boolean;
  alert_uid?: string;
  alert_query?: string;
}

export interface RunCycleResult {
  runId: string;
  rcaId?: string;
  rca: RcaOutput;
  iterations: number;
  stopReason: StopDecision['reason'];
  degraded: boolean;
}

export interface ExpandLoopConfig {
  windowStepMinutes: number;
  windowMaxHours: number;
  backoffMs: number;
  dashboardBaseUrl: string;
}

@Injectable()
export class ExpandLoopService {
  constructor(
    private readonly coord: CoordinatorService,
    private readonly synth: SynthesizerService,
    private readonly stop: StopHookService,
    private readonly past: PastRcaLookup,
    private readonly slack: SlackService,
    private readonly runs: RunsRepo,
    private readonly rcas: RcasRepo,
    private readonly bus: RunStreamBus,
    private readonly cfg: ExpandLoopConfig,
  ) {}

  async runCycle(input: RunCycleInput): Promise<RunCycleResult> {
    const runId = await this.runs.create({
      trigger: input.trigger,
      window: input.window,
      alert_uid: input.alert_uid,
      alert_query: input.alert_query,
    });

    let from = input.window.from;
    const to = input.window.to;
    let iteration = 0;
    let lastRca: RcaOutput | undefined;
    let degraded = false;
    let stopReason: StopDecision['reason'] = 'not_meaningful_yet';

    while (true) {
      iteration++;
      await this.runs.bumpIteration(runId, { from, to });

      const iter = await this.coord.runOneIteration({
        runId,
        components: input.components,
        promptMdByComponent: input.promptMdByComponent,
        window: { from, to },
      });

      if (!CoordinatorService.quorumMet(iter.outputs, input.components.length, 6)) {
        degraded = true;
        lastRca = degradedFallback();
        this.bus.publish(runId, { event: 'iteration_complete', data: { iteration, rca: lastRca, degraded: true } });
        break;
      }

      const suspects = unique([
        ...iter.outputs.map((o) => o.component),
        ...iter.outputs.flatMap((o) => o.suspected_dependencies),
      ]);
      const pastRcas = await this.past.fetch(suspects);

      const synth = await this.synth.synthesize({
        infraMd: input.infraMd,
        dependencyGraph: input.dependencyGraph,
        subagentOutputs: iter.outputs,
        pastRcas,
        window: { from, to },
      });
      lastRca = synth.rca;
      if (synth.degraded) degraded = true;

      const decision = await this.stop.evaluate({
        rca: synth.rca,
        run: { trigger: input.trigger, alert_uid: input.alert_uid, alert_query: input.alert_query },
        window: { from, to },
      });
      this.bus.publish(runId, {
        event: 'iteration_complete',
        data: { iteration, rca: synth.rca, stop_decision: decision },
      });

      if (decision.stop || !input.autoExpand) {
        stopReason = decision.stop ? decision.reason : 'not_meaningful_yet';
        break;
      }

      from = new Date(new Date(from).getTime() - this.cfg.windowStepMinutes * 60_000).toISOString();
      if (hoursBetween(from, to) > this.cfg.windowMaxHours) {
        stopReason = 'time_capped';
        break;
      }
      await new Promise((r) => setTimeout(r, this.cfg.backoffMs));
    }

    let rcaId: string | undefined;
    if (lastRca) {
      try {
        rcaId = await this.rcas.create({ runId, window: { from, to }, rca: lastRca });
      } catch {
        degraded = true;
      }
    }
    await this.runs.finalize(runId, degraded ? 'degraded' : 'completed', stopReason, rcaId);
    this.bus.publish(runId, { event: 'run_complete', data: { rcaId, rca: lastRca, reason: stopReason } });
    this.bus.endRun(runId);

    if (rcaId && lastRca) {
      await this.slack.postRca({
        rca: lastRca,
        runId,
        window: { from, to },
        dashboardUrl: `${this.cfg.dashboardBaseUrl}/rcas/${rcaId}`,
      });
    }

    return { runId, rcaId, rca: lastRca ?? degradedFallback(), iterations: iteration, stopReason, degraded };
  }
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function degradedFallback(): RcaOutput {
  return {
    summary: 'RCA degraded — quorum not met or synthesizer failed',
    root_cause: { component: 'unknown', description: 'insufficient signal', confidence: 0 },
    contributing_factors: [],
    timeline: [],
    evidence: [],
    suggested_next_steps: ['re-run with a wider window', 'check the events panel for upstream failures'],
    similar_past_rcas: [],
  };
}
