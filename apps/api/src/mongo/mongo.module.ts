import { Global, Module, type OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { MongoService } from './mongo.service';

@Global()
@Module({
  providers: [
    {
      provide: MongoService,
      inject: [ConfigService],
      useFactory: async (c: ConfigService) => {
        const svc = new MongoService(c.env.MONGO_URI);
        await svc.connect();
        return svc;
      },
    },
  ],
  exports: [MongoService],
})
export class MongoModule {}
