import { Module } from '@nestjs/common';
import { CLAUDE_CLIENT } from '@rca/agent';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { SynthesizerService } from './synthesizer.service';
import { PastRcaLookup } from './past-rca-lookup';
import { MongoService } from '../mongo/mongo.service';
import { RcasRepo } from '../mongo/rcas.repo';
import { ResolutionsRepo } from '../mongo/resolutions.repo';

@Module({
  imports: [CoordinatorModule],
  providers: [
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    { provide: ResolutionsRepo, inject: [MongoService], useFactory: (m: MongoService) => new ResolutionsRepo(m.db()) },
    PastRcaLookup,
    {
      provide: SynthesizerService,
      inject: [CLAUDE_CLIENT],
      useFactory: (c) => new SynthesizerService(c),
    },
  ],
  exports: [SynthesizerService, PastRcaLookup, RcasRepo, ResolutionsRepo],
})
export class SynthesizerModule {}
