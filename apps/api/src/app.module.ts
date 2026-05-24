import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { pinoOptions } from './logger/pino-logger';
import { InfraModule } from './infra/infra.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => pinoOptions(c.env.LOG_LEVEL),
    }),
    InfraModule,
    HealthModule,
  ],
})
export class AppModule {}
