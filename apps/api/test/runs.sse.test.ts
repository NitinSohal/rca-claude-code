import { describe, it, expect } from 'vitest';
import { RunStreamBus } from '../src/coordinator/stream';
import { formatSse } from '../src/runs/runs.controller';

describe('formatSse', () => {
  it('produces the documented SSE wire format', () => {
    const out = formatSse({ event: 'iteration_start', data: { iteration: 1 } });
    expect(out).toBe(`event: iteration_start\ndata: ${JSON.stringify({ iteration: 1 })}\n\n`);
  });
});

describe('RunStreamBus integration with formatter', () => {
  it('formats replayed + live messages', async () => {
    const bus = new RunStreamBus();
    bus.publish('r1', { event: 'a', data: { x: 1 } });
    const lines: string[] = [];
    bus.subscribe('r1', (msg) => lines.push(formatSse(msg)));
    bus.publish('r1', { event: 'b', data: { y: 2 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(lines.join('')).toContain('event: a');
    expect(lines.join('')).toContain('event: b');
  });
});
