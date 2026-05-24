import { Module } from '@nestjs/common';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { InfraModule } from '../infra/infra.module';
import { MongoService } from '../mongo/mongo.service';
import { AlertsRepo } from '../mongo/alerts.repo';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { FsPromptReader } from '../rca/rca.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [ExpandLoopModule, InfraModule],
  controllers: [WebhookController],
  providers: [
    { provide: AlertsRepo, inject: [MongoService], useFactory: (m: MongoService) => new AlertsRepo(m.db()) },
    {
      provide: WebhookController,
      inject: [ExpandLoopService, AlertsRepo, InfraLoaderService],
      useFactory: (loop, alerts, infra) =>
        new WebhookController(loop, alerts, infra, new FsPromptReader('/app/infra/prompts')),
    },
  ],
})
export class WebhookModule {}
