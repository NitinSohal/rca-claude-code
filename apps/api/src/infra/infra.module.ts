import { Module } from '@nestjs/common';
import { InfraLoaderService } from './infra-loader.service';

// NOTE: The factory wiring below depends on ConfigService from `../config/config.service`,
// which is created in Phase 3 (Task 3.1). To keep `apps/api` typecheck-clean during Phase 2,
// the factory is stubbed out here. Phase 3 Task 3.1 will reactivate it by uncommenting the
// block below and removing the empty `providers` array.
//
// import { ConfigService } from '../config/config.service';
//
// @Module({
//   providers: [
//     {
//       provide: InfraLoaderService,
//       inject: [ConfigService],
//       useFactory: (config: ConfigService) => {
//         const loader = new InfraLoaderService({
//           infraMdPath: config.env.INFRA_MD_PATH,
//           promptsDir: '/app/infra/prompts',
//           maxComponents: config.env.MAX_COMPONENTS,
//         });
//         loader.load();
//         return loader;
//       },
//     },
//   ],
//   exports: [InfraLoaderService],
// })

@Module({
  providers: [],
  exports: [InfraLoaderService],
})
export class InfraModule {}
