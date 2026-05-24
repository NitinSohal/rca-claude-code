import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { GrafanaModule } from '../grafana/grafana.module';
import { OutboundCallGuard } from '../guard/outbound-call-guard';
import { SlackService } from './slack.service';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: SlackService,
      inject: [ConfigService, OutboundCallGuard],
      useFactory: (c: ConfigService, g: OutboundCallGuard) =>
        new SlackService(c.env.SLACK_WEBHOOK_URL ?? '', g),
    },
  ],
  exports: [SlackService],
})
export class SlackModule {}
