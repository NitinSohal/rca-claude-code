import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { SynthesizerModule } from '../synthesizer/synthesizer.module';
import { StopHookModule } from '../stop-hook/stop-hook.module';
import { SlackModule } from '../slack/slack.module';
import { MongoService } from '../mongo/mongo.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RcasRepo } from '../mongo/rcas.repo';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SynthesizerService } from '../synthesizer/synthesizer.service';
import { StopHookService } from '../stop-hook/stop-hook.service';
import { PastRcaLookup } from '../synthesizer/past-rca-lookup';
import { SlackService } from '../slack/slack.service';
import { RunStreamBus } from '../coordinator/stream';
import { ExpandLoopService } from './expand-loop.service';

@Module({
  imports: [CoordinatorModule, SynthesizerModule, StopHookModule, SlackModule],
  providers: [
    { provide: RunsRepo, inject: [MongoService], useFactory: (m: MongoService) => new RunsRepo(m.db()) },
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    {
      provide: ExpandLoopService,
      inject: [
        CoordinatorService,
        SynthesizerService,
        StopHookService,
        PastRcaLookup,
        SlackService,
        RunsRepo,
        RcasRepo,
        RunStreamBus,
        ConfigService,
      ],
      useFactory: (...args: any[]) => {
        const [coord, synth, stop, past, slack, runs, rcas, bus, c] = args;
        return new ExpandLoopService(coord, synth, stop, past, slack, runs, rcas, bus, {
          windowStepMinutes: (c as ConfigService).env.WINDOW_STEP_MINUTES,
          windowMaxHours: (c as ConfigService).env.WINDOW_MAX_HOURS,
          backoffMs: (c as ConfigService).env.BACKOFF_MS,
          dashboardBaseUrl: 'http://localhost:3000',
        });
      },
    },
  ],
  exports: [ExpandLoopService],
})
export class ExpandLoopModule {}
