import { Module } from '@nestjs/common';
import { GrafanaModule } from '../grafana/grafana.module';
import { GrafanaService } from '../grafana/grafana.service';
import { ConfigService } from '../config/config.service';
import { StopHookService } from './stop-hook.service';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: StopHookService,
      inject: [GrafanaService, ConfigService],
      useFactory: (g: GrafanaService, c: ConfigService) =>
        new StopHookService(g, {
          confidenceThreshold: c.env.RCA_CONFIDENCE_THRESHOLD,
          baselineTolerance: c.env.BASELINE_TOLERANCE,
          windowMaxHours: c.env.WINDOW_MAX_HOURS,
        }),
    },
  ],
  exports: [StopHookService],
})
export class StopHookModule {}
