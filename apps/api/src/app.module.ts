import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { pinoOptions } from './logger/pino-logger';
import { InfraModule } from './infra/infra.module';
import { HealthModule } from './health/health.module';
import { MongoModule } from './mongo/mongo.module';
import { EventsModule } from './events/events.module';
import { GrafanaModule } from './grafana/grafana.module';
import { ExpandLoopModule } from './expand-loop/expand-loop.module';
import { RcaModule } from './rca/rca.module';
import { RunsModule } from './runs/runs.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => pinoOptions(c.env.LOG_LEVEL),
    }),
    InfraModule,
    MongoModule,
    EventsModule,
    GrafanaModule,
    ExpandLoopModule,
    RcaModule,
    RunsModule,
    WebhookModule,
    HealthModule,
  ],
})
export class AppModule {}
