import { Module } from '@nestjs/common';
import { CLAUDE_CLIENT, RealClaudeClient, type ClaudeClient } from '@rca/agent';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { GrafanaModule } from '../grafana/grafana.module';
import { GrafanaService } from '../grafana/grafana.service';
import { CoordinatorService } from './coordinator.service';
import { SubagentRunner } from './subagent-runner';
import { Prefetcher } from './prefetcher';
import { RunStreamBus } from './stream';
import { DependencyBus } from './dependency-bus';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: CLAUDE_CLIENT,
      useFactory: (): ClaudeClient =>
        new RealClaudeClient({
          queryFn: query as any,
          defaultModel: 'claude-sonnet-4-6',
          maxTurns: 8,
        }),
    },
    {
      provide: SubagentRunner,
      inject: [CLAUDE_CLIENT],
      useFactory: (c: ClaudeClient) => new SubagentRunner(c, { timeoutMs: 90_000 }),
    },
    {
      provide: Prefetcher,
      inject: [GrafanaService],
      useFactory: (g: GrafanaService) => new Prefetcher(g, { concurrency: 10 }),
    },
    RunStreamBus,
    DependencyBus,
    CoordinatorService,
  ],
  exports: [CoordinatorService, RunStreamBus, DependencyBus, SubagentRunner, CLAUDE_CLIENT],
})
export class CoordinatorModule {}
