import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';

export type GuardTarget = 'grafana' | 'anthropic' | 'mongo' | 'slack' | 'claude_auth';

export interface GuardCallParams {
  target: GuardTarget;
  operation: string;
  retries?: number;
  baseDelayMs?: number;
  runId?: string;
  component?: string;
}

export interface EventsSink {
  recordFailure(input: {
    target: GuardTarget;
    operation: string;
    error: Error;
    attempts: number;
    runId?: string;
    component?: string;
  }): Promise<void>;
  recordSuccess(input: { target: GuardTarget; operation: string }): Promise<void>;
}

@Injectable()
export class OutboundCallGuard {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly events: EventsSink) {}

  private breaker(key: string): CircuitBreaker {
    let cb = this.breakers.get(key);
    if (!cb) {
      cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
      this.breakers.set(key, cb);
    }
    return cb;
  }

  breakerState(target: GuardTarget, operation: string) {
    return this.breaker(`${target}:${operation}`).state();
  }

  async withGuard<T>(params: GuardCallParams, fn: () => Promise<T>): Promise<T> {
    const key = `${params.target}:${params.operation}`;
    const breaker = this.breaker(key);
    if (!breaker.canPass()) {
      throw new Error(`Circuit open for ${key}`);
    }

    const retries = params.retries ?? 2;
    const baseDelayMs = params.baseDelayMs ?? 250;
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const out = await fn();
        breaker.recordSuccess();
        await this.events.recordSuccess({ target: params.target, operation: params.operation });
        return out;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(4, attempt)));
        }
      }
    }
    breaker.recordFailure();
    await this.events.recordFailure({
      target: params.target,
      operation: params.operation,
      error: lastErr!,
      attempts: retries + 1,
      runId: params.runId,
      component: params.component,
    });
    throw lastErr!;
  }
}
