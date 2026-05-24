import { Injectable } from '@nestjs/common';
import type { Component, SubagentOutput } from '@rca/agent';
import { SubagentRunner, type SubagentRunResult } from './subagent-runner';
import { Prefetcher, type PrefetchedComponent } from './prefetcher';
import { RunStreamBus } from './stream';
import { DependencyBus } from './dependency-bus';

export interface OneIterationInput {
  runId: string;
  components: Component[];
  promptMdByComponent: Record<string, string>;
  window: { from: string; to: string };
}

export interface OneIterationResult {
  outputs: SubagentOutput[];
  totalTokens: { input: number; output: number; cache_read: number; cache_write: number };
  prefetched: Record<string, PrefetchedComponent>;
}

@Injectable()
export class CoordinatorService {
  constructor(
    private readonly runner: SubagentRunner,
    private readonly prefetcher: Prefetcher,
    private readonly bus: RunStreamBus,
    private readonly deps: DependencyBus,
  ) {}

  async runOneIteration(input: OneIterationInput): Promise<OneIterationResult> {
    this.bus.publish(input.runId, {
      event: 'iteration_start',
      data: { window: input.window },
    });

    const prefetched = await this.prefetcher.fetchAll(input.components, input.window);
    this.bus.publish(input.runId, { event: 'prefetch_done', data: { components: Object.keys(prefetched) } });

    this.deps.reset();
    const results = await Promise.all(
      input.components.map(async (c) => {
        this.bus.publish(input.runId, { event: 'subagent_progress', data: { component: c.name, status: 'running' } });
        const res = await this.runner.run({
          componentName: c.name,
          promptMd: input.promptMdByComponent[c.name] ?? '',
          window: input.window,
          prefetched: prefetched[c.name],
        });
        this.deps.publish(c.name, res.output);
        this.bus.publish(input.runId, { event: 'subagent_done', data: { component: c.name, output: res.output } });
        return res;
      }),
    );

    return aggregate(results, prefetched);
  }

  static quorumMet(outputs: SubagentOutput[], total: number, threshold: number): boolean {
    const usable = outputs.filter((o) => o.status !== 'inconclusive').length;
    return usable >= Math.min(threshold, total);
  }
}

function aggregate(
  results: SubagentRunResult[],
  prefetched: Record<string, PrefetchedComponent>,
): OneIterationResult {
  const totalTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const r of results) {
    totalTokens.input += r.tokens.input;
    totalTokens.output += r.tokens.output;
    totalTokens.cache_read += r.tokens.cache_read;
    totalTokens.cache_write += r.tokens.cache_write;
  }
  return { outputs: results.map((r) => r.output), totalTokens, prefetched };
}
