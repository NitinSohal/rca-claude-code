import { Controller, Get, Param, Res, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { RunStreamBus, type RunMessage } from '../coordinator/stream';
import { RunsRepo } from '../mongo/runs.repo';

export function formatSse(m: RunMessage): string {
  return `event: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`;
}

@Controller('api/runs')
export class RunsController {
  constructor(
    private readonly bus: RunStreamBus,
    private readonly runs: RunsRepo,
  ) {}

  @Get(':id')
  async one(@Param('id') id: string) {
    return this.runs.findById(id);
  }

  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsub = this.bus.subscribe(id, (m) => {
        subscriber.next({ type: m.event, data: m.data });
      });
      return () => unsub();
    });
  }
}
