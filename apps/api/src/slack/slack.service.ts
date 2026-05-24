import { Injectable } from '@nestjs/common';
import type { RcaOutput } from '@rca/agent';
import { OutboundCallGuard } from '../guard/outbound-call-guard';

export interface PostRcaInput {
  rca: RcaOutput;
  runId: string;
  window: { from: string; to: string };
  dashboardUrl: string;
}

@Injectable()
export class SlackService {
  constructor(
    private readonly webhookUrl: string,
    private readonly guard: OutboundCallGuard,
  ) {}

  async postRca(input: PostRcaInput): Promise<void> {
    if (!this.webhookUrl) return;
    const blocks = formatBlocks(input);
    try {
      await this.guard.withGuard(
        { target: 'slack', operation: 'post_rca', retries: 3 },
        async () => {
          const res = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: input.rca.summary, blocks }),
          });
          if (res.status >= 500) throw new Error(`slack ${res.status}`);
          if (res.status >= 400) return;
        },
      );
    } catch {
      // never block RCA completion — guard already records the event
    }
  }
}

function formatBlocks(input: PostRcaInput) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `RCA: ${input.rca.root_cause.component}`, emoji: false },
    },
    { type: 'section', text: { type: 'mrkdwn', text: input.rca.summary } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Window:* ${input.window.from} → ${input.window.to}` },
        { type: 'mrkdwn', text: `*Confidence:* ${input.rca.root_cause.confidence}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `<${input.dashboardUrl}|Open in dashboard>` },
    },
  ];
}
