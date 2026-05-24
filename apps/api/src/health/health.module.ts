import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { InfraModule } from '../infra/infra.module';

const stubPing = { ping: async () => true };
const stubAuth = { checkAuth: async () => true };
const stubEvents = { getCounts: () => ({ critical: 0, error: 0, warn: 0 }) };

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [
    { provide: 'GRAFANA_PING', useValue: stubPing },
    { provide: 'MONGO_PING', useValue: stubPing },
    { provide: 'CLAUDE_AUTH', useValue: stubAuth },
    { provide: 'EVENTS_COUNTS', useValue: stubEvents },
    {
      provide: HealthController,
      inject: ['GRAFANA_PING', 'MONGO_PING', 'CLAUDE_AUTH', 'EVENTS_COUNTS', InfraLoaderService],
      useFactory: (g: any, m: any, a: any, e: any, infra: InfraLoaderService) =>
        new HealthController(g, m, a, e, infra),
    },
  ],
})
export class HealthModule {}
