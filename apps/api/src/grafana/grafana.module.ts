import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { OutboundCallGuard } from '../guard/outbound-call-guard';
import { EventsService } from '../events/events.service';
import { GrafanaService } from './grafana.service';
import { discoverDatasources } from './datasource-discovery';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [
    {
      provide: OutboundCallGuard,
      inject: [EventsService],
      useFactory: (e: EventsService) => new OutboundCallGuard(e),
    },
    {
      provide: GrafanaService,
      inject: [ConfigService, OutboundCallGuard],
      useFactory: async (c: ConfigService, guard: OutboundCallGuard) => {
        const discovered = await discoverDatasources({
          baseUrl: c.env.GRAFANA_URL,
          token: c.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
        });
        return new GrafanaService(
          {
            baseUrl: c.env.GRAFANA_URL,
            token: c.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
            uids: {
              loki: c.env.LOKI_DATASOURCE_UID ?? discovered.loki,
              prom: c.env.PROM_DATASOURCE_UID ?? discovered.prom,
              cw: c.env.CW_DATASOURCE_UID ?? discovered.cw,
            },
          },
          guard,
        );
      },
    },
  ],
  exports: [GrafanaService, OutboundCallGuard],
})
export class GrafanaModule {}
