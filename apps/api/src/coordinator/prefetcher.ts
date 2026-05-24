import { Injectable } from '@nestjs/common';
import type { Component } from '@rca/agent';
import type { GrafanaService } from '../grafana/grafana.service';

export interface PrefetchedComponent {
  window: { from: string; to: string };
  loki: {
    error_lines: { ts: string; line: string }[];
    stats: { total_lines: number };
  };
  prometheus: Record<string, [number, number][]>;
  cloudwatch: Record<string, [number, number][]>;
  data_unavailable: boolean;
}

export interface PrefetcherOpts {
  concurrency: number;
}

export class Prefetcher {
  constructor(
    private readonly grafana: GrafanaService,
    private readonly opts: PrefetcherOpts = { concurrency: 10 },
  ) {}

  async fetchAll(
    components: Component[],
    window: { from: string; to: string },
  ): Promise<Record<string, PrefetchedComponent>> {
    const semaphore = new Semaphore(this.opts.concurrency);
    const result: Record<string, PrefetchedComponent> = {};

    await Promise.all(
      components.map(async (c) => {
        result[c.name] = await this.fetchOne(c, window, semaphore);
      }),
    );
    return result;
  }

  private async fetchOne(
    c: Component,
    window: { from: string; to: string },
    sem: Semaphore,
  ): Promise<PrefetchedComponent> {
    const out: PrefetchedComponent = {
      window,
      loki: { error_lines: [], stats: { total_lines: 0 } },
      prometheus: {},
      cloudwatch: {},
      data_unavailable: false,
    };
    const tasks: Promise<void>[] = [];

    if (c.loki) {
      const logql = c.loki.error_filter
        ? `${c.loki.selector} ${c.loki.error_filter}`
        : c.loki.selector;
      tasks.push(
        sem.with(async () => {
          try {
            const r = await this.grafana.queryLoki({
              logql,
              from: window.from,
              to: window.to,
              limit: 500,
            });
            out.loki.error_lines = r.lines;
            out.loki.stats.total_lines = r.total_lines;
          } catch {
            out.data_unavailable = true;
          }
        }),
      );
    }

    for (const m of c.prometheus?.metrics ?? []) {
      tasks.push(
        sem.with(async () => {
          try {
            const r = await this.grafana.queryProm({
              promql: m.query,
              from: window.from,
              to: window.to,
              step: '60s',
              maxPoints: 100,
            });
            out.prometheus[m.name] = r.points;
          } catch {
            out.data_unavailable = true;
          }
        }),
      );
    }

    if (c.cloudwatch) {
      for (const metric of c.cloudwatch.metrics) {
        tasks.push(
          sem.with(async () => {
            try {
              const r = await this.grafana.queryCloudWatch({
                namespace: c.cloudwatch!.namespace,
                dimensions: c.cloudwatch!.dimensions,
                metric,
                from: window.from,
                to: window.to,
                maxPoints: 100,
              });
              out.cloudwatch[metric] = r.points;
            } catch {
              out.data_unavailable = true;
            }
          }),
        );
      }
    }

    await Promise.all(tasks);
    return out;
  }
}

class Semaphore {
  private available: number;
  private queue: (() => void)[] = [];
  constructor(n: number) {
    this.available = n;
  }
  async with<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((res) => this.queue.push(res));
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
}

@Injectable()
export class PrefetcherService extends Prefetcher {}
