import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { AlertsRepo } from '../mongo/alerts.repo';
import { InfraLoaderService } from '../infra/infra-loader.service';
import type { PromptReader } from '../rca/rca.controller';

const WebhookPayload = z.object({
  status: z.string(),
  alerts: z.array(
    z.object({
      labels: z.record(z.string(), z.string()).default({}),
      annotations: z.record(z.string(), z.string()).default({}),
      startsAt: z.string().optional(),
      valueString: z.string().optional(),
    }),
  ).default([]),
});

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly loop: ExpandLoopService,
    private readonly alerts: AlertsRepo,
    private readonly infra: InfraLoaderService,
    private readonly prompts: PromptReader,
  ) {}

  @Post('grafana')
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: unknown) {
    const parsed = WebhookPayload.safeParse(body);
    if (!parsed.success) return { ignored: true, error: 'bad payload' };
    if (parsed.data.status !== 'firing') return { ignored: true };

    const alert = parsed.data.alerts[0];
    if (!alert) return { ignored: true };

    const alertUid = alert.labels['__alert_rule_uid__'] ?? alert.labels['alertname'] ?? 'unknown';
    const query = extractQuery(alert.valueString ?? '');
    await this.alerts.cache(alertUid, alert as Record<string, unknown>, query);

    const startedAt = alert.startsAt ? new Date(alert.startsAt) : new Date();
    const to = new Date(Date.now()).toISOString();
    const from = new Date(startedAt.getTime() - 4 * 3_600_000).toISOString();

    const components = this.infra.getComponents();
    const promptMdByComponent: Record<string, string> = {};
    for (const c of components) promptMdByComponent[c.name] = this.prompts.read(c.name);

    return this.loop.runCycle({
      trigger: 'webhook',
      window: { from, to },
      components,
      promptMdByComponent,
      infraMd: this.infra.getProse(),
      dependencyGraph: this.infra.getDependencyGraph(),
      autoExpand: true,
      alert_uid: alertUid,
      alert_query: query,
    });
  }
}

function extractQuery(valueString: string): string {
  const m = valueString.match(/query=([^\s\]]+)/);
  return m ? m[1] : '';
}
