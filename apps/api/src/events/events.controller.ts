import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { EventsRepo, type EventSource, type Severity, type EventStatus } from '../mongo/events.repo';

@Controller('api/events')
export class EventsController {
  constructor(private readonly repo: EventsRepo) {}

  @Get()
  list(
    @Query('severity') severity?: Severity,
    @Query('source') source?: EventSource,
    @Query('status') status?: EventStatus,
  ) {
    return this.repo.list({ severity, source, status });
  }

  @Get('unacknowledged')
  unack() {
    return this.repo.listUnacknowledged();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.repo.findById(id);
  }

  @Patch(':id/ignore')
  async ignore(@Param('id') id: string) {
    await this.repo.ignore(id);
    return { ok: true };
  }

  @Patch(':id/resolve')
  async resolve(@Param('id') id: string) {
    await this.repo.resolve(id);
    return { ok: true };
  }

  @Patch(':id/acknowledge')
  async ack(@Param('id') id: string, @Body() body: { by?: string }) {
    await this.repo.acknowledge(id, body.by ?? 'user');
    return { ok: true };
  }
}
