import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../src/guard/circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts CLOSED and stays CLOSED on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
    cb.recordSuccess();
    expect(cb.state()).toBe('CLOSED');
    expect(cb.canPass()).toBe(true);
  });

  it('opens after threshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    expect(cb.canPass()).toBe(false);
  });

  it('half-opens after openMs elapses', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    vi.advanceTimersByTime(101);
    expect(cb.canPass()).toBe(true);
    expect(cb.state()).toBe('HALF_OPEN');
    vi.useRealTimers();
  });

  it('a success in HALF_OPEN closes the circuit', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(101);
    cb.canPass();
    cb.recordSuccess();
    expect(cb.state()).toBe('CLOSED');
    vi.useRealTimers();
  });

  it('a failure in HALF_OPEN re-opens the circuit', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(101);
    cb.canPass();
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    vi.useRealTimers();
  });
});
