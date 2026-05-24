import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { InfraLoaderService } from './infra-loader.service';

@Module({
  providers: [
    {
      provide: InfraLoaderService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const loader = new InfraLoaderService({
          infraMdPath: config.env.INFRA_MD_PATH,
          promptsDir: '/app/infra/prompts',
          maxComponents: config.env.MAX_COMPONENTS,
        });
        loader.load();
        return loader;
      },
    },
  ],
  exports: [InfraLoaderService],
})
export class InfraModule {}
