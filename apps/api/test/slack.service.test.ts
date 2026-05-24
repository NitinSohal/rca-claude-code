import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { SlackService } from '../src/slack/slack.service';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

afterEach(() => nock.cleanAll());
const sink = { recordFailure: async () => {}, recordSuccess: async () => {} };

describe('SlackService.postRca', () => {
  it('POSTs JSON to the configured webhook url', async () => {
    const scope = nock('https://hooks').post('/services/AAA').reply(200, 'ok');
    const svc = new SlackService('https://hooks/services/AAA', new OutboundCallGuard(sink));
    await svc.postRca({
      rca: {
        summary: 'Postgres pool exhausted',
        root_cause: { component: 'postgres-primary', description: 'd', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: [],
        similar_past_rcas: [],
      },
      runId: 'r1',
      window: { from: 'a', to: 'b' },
      dashboardUrl: 'http://localhost:3000/rcas/r1',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('does not throw on 4xx (slack failures must never block RCA completion)', async () => {
    nock('https://hooks').post('/services/AAA').reply(404, 'no');
    const svc = new SlackService('https://hooks/services/AAA', new OutboundCallGuard(sink));
    await expect(svc.postRca({
      rca: {
        summary: 's',
        root_cause: { component: 'c', description: 'd', confidence: 0.5 },
        contributing_factors: [], timeline: [], evidence: [], suggested_next_steps: [], similar_past_rcas: [],
      },
      runId: 'r1', window: { from: 'a', to: 'b' }, dashboardUrl: '',
    })).resolves.toBeUndefined();
  });

  it('is a no-op when webhook url is empty', async () => {
    const svc = new SlackService('', new OutboundCallGuard(sink));
    await expect(svc.postRca({
      rca: {
        summary: 's',
        root_cause: { component: 'c', description: 'd', confidence: 0.5 },
        contributing_factors: [], timeline: [], evidence: [], suggested_next_steps: [], similar_past_rcas: [],
      },
      runId: 'r1', window: { from: 'a', to: 'b' }, dashboardUrl: '',
    })).resolves.toBeUndefined();
  });
});
