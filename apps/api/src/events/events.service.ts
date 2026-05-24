import { Injectable } from '@nestjs/common';
import { EventsRepo, type EventSource, type Severity } from '../mongo/events.repo';
import type { EventsSink, GuardTarget } from '../guard/outbound-call-guard';

export interface EventsServiceOptions {
  logSuccesses?: boolean;
}

const TARGET_TO_SOURCE: Record<GuardTarget, EventSource> = {
  grafana: 'grafana',
  anthropic: 'anthropic',
  mongo: 'mongo',
  slack: 'slack',
  claude_auth: 'claude_auth',
};

const SEVERITY_BY_TARGET: Record<GuardTarget, Severity> = {
  grafana: 'critical',
  anthropic: 'critical',
  mongo: 'critical',
  slack: 'error',
  claude_auth: 'critical',
};

const SUGGESTED_FIX: Partial<Record<GuardTarget, string>> = {
  grafana: 'Check GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN validity.',
  slack: 'Verify SLACK_WEBHOOK_URL.',
  anthropic: 'Check Anthropic status + Claude CLI auth (run `claude login`).',
  claude_auth: 'Run `claude login` on host then restart rca-api.',
  mongo: 'Check MONGO_URI and that the database is reachable.',
};

@Injectable()
export class EventsService implements EventsSink {
  constructor(
    private readonly repo: EventsRepo,
    private readonly opts: EventsServiceOptions = {},
  ) {}

  async recordFailure(input: {
    target: GuardTarget;
    operation: string;
    error: Error;
    attempts: number;
    runId?: string;
    component?: string;
  }): Promise<void> {
    await this.repo.insert({
      severity: SEVERITY_BY_TARGET[input.target],
      source: TARGET_TO_SOURCE[input.target],
      operation: input.operation,
      message: `${input.target}.${input.operation} failed after ${input.attempts} attempt(s): ${input.error.message}`,
      context: { run_id: input.runId, component: input.component, attempts: input.attempts },
      suggested_fix: SUGGESTED_FIX[input.target],
    });
  }

  async recordSuccess(input: { target: GuardTarget; operation: string }): Promise<void> {
    const source = TARGET_TO_SOURCE[input.target];
    await this.repo.autoResolve(source, input.operation);
    if (this.opts.logSuccesses) {
      await this.repo.insert({
        severity: 'info',
        source,
        operation: input.operation,
        message: `${input.target}.${input.operation} succeeded`,
      });
    }
  }

  async recordCircuitBreakerOpen(target: GuardTarget, operation: string): Promise<void> {
    await this.repo.insert({
      severity: 'critical',
      source: 'circuit_breaker',
      operation: `${target}:${operation}`,
      message: `Circuit opened for ${target}.${operation} after 5 consecutive failures`,
    });
  }

  async getCounts(): Promise<{ critical: number; error: number; warn: number }> {
    const c = await this.repo.countsBySeverity();
    return { critical: c.critical, error: c.error, warn: c.warn };
  }
}
