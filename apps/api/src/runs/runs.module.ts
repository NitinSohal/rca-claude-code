import { Module } from '@nestjs/common';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { MongoService } from '../mongo/mongo.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RunsController } from './runs.controller';

@Module({
  imports: [CoordinatorModule],
  controllers: [RunsController],
  providers: [
    { provide: RunsRepo, inject: [MongoService], useFactory: (m: MongoService) => new RunsRepo(m.db()) },
  ],
})
export class RunsModule {}
