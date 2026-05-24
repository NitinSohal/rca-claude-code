import { CommandFactory } from 'nest-commander';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { MongoModule } from '../mongo/mongo.module';
import { InfraModule } from '../infra/infra.module';
import { GrafanaModule } from '../grafana/grafana.module';
import { EventsModule } from '../events/events.module';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { AnalyzeCommand } from './analyze.command';
import { HealthCommand } from './health.command';
import { ResolveCommand } from './resolve.command';
import { RcasRepo } from '../mongo/rcas.repo';
import { MongoService } from '../mongo/mongo.service';

@Module({
  imports: [ConfigModule, MongoModule, InfraModule, EventsModule, GrafanaModule, ExpandLoopModule],
  providers: [
    AnalyzeCommand,
    HealthCommand,
    ResolveCommand,
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
  ],
})
export class CliModule {}

if (process.argv[1]?.endsWith('cli.module.ts') || process.argv[1]?.endsWith('cli.module.js')) {
  CommandFactory.run(CliModule, { logger: ['error'] }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
