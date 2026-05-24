import { Module } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service';
import { EventsRepo } from '../mongo/events.repo';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { ConfigService } from '../config/config.service';

@Module({
  providers: [
    {
      provide: EventsRepo,
      inject: [MongoService],
      useFactory: (m: MongoService) => new EventsRepo(m.db()),
    },
    {
      provide: EventsService,
      inject: [EventsRepo, ConfigService],
      useFactory: (r: EventsRepo, c: ConfigService) =>
        new EventsService(r, { logSuccesses: c.env.LOG_SUCCESSES }),
    },
  ],
  controllers: [EventsController],
  exports: [EventsService, EventsRepo],
})
export class EventsModule {}
