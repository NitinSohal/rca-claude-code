import { Command, CommandRunner } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service';
import { GrafanaService } from '../grafana/grafana.service';

@Injectable()
@Command({ name: 'health', description: 'Probe Grafana + Mongo + Claude auth' })
export class HealthCommand extends CommandRunner {
  constructor(
    private readonly grafana: GrafanaService,
    private readonly mongo: MongoService,
  ) {
    super();
  }
  async run(): Promise<void> {
    const [g, m] = await Promise.all([this.grafana.ping(), this.mongo.ping()]);
    console.log(JSON.stringify({ grafana: g, mongo: m }, null, 2));
    process.exit(g && m ? 0 : 1);
  }
}
