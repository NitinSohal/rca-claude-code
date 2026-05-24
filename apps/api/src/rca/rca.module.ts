import { Module } from '@nestjs/common';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { InfraModule } from '../infra/infra.module';
import { MongoService } from '../mongo/mongo.service';
import { RcasRepo } from '../mongo/rcas.repo';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { FsPromptReader, RcaController } from './rca.controller';

@Module({
  imports: [ExpandLoopModule, InfraModule],
  controllers: [RcaController],
  providers: [
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    {
      provide: RcaController,
      inject: [ExpandLoopService, InfraLoaderService, RcasRepo],
      useFactory: (loop, infra, rcas) =>
        new RcaController(loop, infra, new FsPromptReader('/app/infra/prompts'), rcas),
    },
  ],
})
export class RcaModule {}
