import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { RcasRepo } from '../mongo/rcas.repo';

@Injectable()
@Command({ name: 'resolve', description: 'Mark an RCA resolved with a note' })
export class ResolveCommand extends CommandRunner {
  constructor(private readonly rcas: RcasRepo) {
    super();
  }
  async run(_p: string[], opts: { id: string; note: string }): Promise<void> {
    await this.rcas.markResolved(opts.id, opts.note, []);
    console.log(`resolved ${opts.id}`);
    process.exit(0);
  }
  @Option({ flags: '--id <id>', required: true })
  parseId(v: string): string { return v; }
  @Option({ flags: '--note <text>', required: true })
  parseNote(v: string): string { return v; }
}
