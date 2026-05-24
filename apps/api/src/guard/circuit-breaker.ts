export type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  state(): CbState {
    if (this.openedAt === null) return 'CLOSED';
    if (Date.now() - this.openedAt >= this.opts.openMs) return 'HALF_OPEN';
    return 'OPEN';
  }

  canPass(): boolean {
    return this.state() !== 'OPEN';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    const s = this.state();
    if (s === 'HALF_OPEN') {
      this.openedAt = Date.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) {
      this.openedAt = Date.now();
    }
  }
}
