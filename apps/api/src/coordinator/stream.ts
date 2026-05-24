import { Injectable } from '@nestjs/common';

export interface RunMessage {
  event: string;
  data: unknown;
}
export type RunListener = (msg: RunMessage) => void;

export interface RunStreamBusOptions {
  replayLimit?: number;
  ttlMs?: number;
}

interface RunChannel {
  buffer: RunMessage[];
  listeners: Set<RunListener>;
  ended: boolean;
}

@Injectable()
export class RunStreamBus {
  private channels = new Map<string, RunChannel>();
  private readonly replayLimit: number;
  private readonly ttlMs: number;

  constructor(opts: RunStreamBusOptions = {}) {
    this.replayLimit = opts.replayLimit ?? 200;
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
  }

  private ch(runId: string): RunChannel {
    let c = this.channels.get(runId);
    if (!c) {
      c = { buffer: [], listeners: new Set(), ended: false };
      this.channels.set(runId, c);
    }
    return c;
  }

  publish(runId: string, msg: RunMessage): void {
    const c = this.ch(runId);
    c.buffer.push(msg);
    if (c.buffer.length > this.replayLimit) c.buffer.shift();
    for (const l of c.listeners) {
      queueMicrotask(() => l(msg));
    }
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const c = this.ch(runId);
    for (const m of c.buffer) queueMicrotask(() => listener(m));
    c.listeners.add(listener);
    return () => c.listeners.delete(listener);
  }

  endRun(runId: string): void {
    const c = this.ch(runId);
    c.ended = true;
    setTimeout(() => this.channels.delete(runId), this.ttlMs);
  }

  snapshot(runId: string): RunMessage[] {
    return this.channels.get(runId)?.buffer ?? [];
  }
}
