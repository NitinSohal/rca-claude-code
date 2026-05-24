import { describe, it, expect } from 'vitest';
import { RunStreamBus } from '../src/coordinator/stream';

describe('RunStreamBus', () => {
  it('delivers events to subscribers and buffers late subscribers up to N events', async () => {
    const bus = new RunStreamBus();
    bus.publish('run-1', { event: 'iteration_start', data: { iteration: 1 } });
    bus.publish('run-1', { event: 'subagent_done', data: { component: 'x' } });

    const seen: any[] = [];
    const unsub = bus.subscribe('run-1', (msg) => seen.push(msg.event));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['iteration_start', 'subagent_done']);
    unsub();
  });

  it('delivers live events after subscription', async () => {
    const bus = new RunStreamBus();
    const seen: string[] = [];
    bus.subscribe('run-2', (m) => seen.push(m.event));
    bus.publish('run-2', { event: 'run_complete', data: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain('run_complete');
  });

  it('ends a run and drops its buffer after the configured ttl', async () => {
    const bus = new RunStreamBus({ replayLimit: 10, ttlMs: 5 });
    bus.publish('run-3', { event: 'x', data: {} });
    bus.endRun('run-3');
    await new Promise((r) => setTimeout(r, 20));
    expect(bus.snapshot('run-3')).toEqual([]);
  });
});
