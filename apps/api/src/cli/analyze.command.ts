import { Command, CommandRunner, Option } from 'nest-commander';
import { Injectable } from '@nestjs/common';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { FsPromptReader, type PromptReader } from '../rca/rca.controller';

export interface AnalyzeArgs {
  from: string;
  to: string;
  autoExpand: boolean;
}

export interface AnalyzeDeps {
  loop: ExpandLoopService;
  infra: InfraLoaderService;
  prompts: PromptReader;
  log: (msg: string) => void;
}

export async function analyzeHandler(args: AnalyzeArgs, deps: AnalyzeDeps): Promise<number> {
  const components = deps.infra.getComponents();
  const promptMdByComponent: Record<string, string> = {};
  for (const c of components) promptMdByComponent[c.name] = deps.prompts.read(c.name);
  const r = await deps.loop.runCycle({
    trigger: 'manual',
    window: { from: args.from, to: args.to },
    components,
    promptMdByComponent,
    infraMd: deps.infra.getProse(),
    dependencyGraph: deps.infra.getDependencyGraph(),
    autoExpand: args.autoExpand,
  });
  deps.log(`runId=${r.runId} rcaId=${r.rcaId ?? '-'} iterations=${r.iterations} stop=${r.stopReason}`);
  return 0;
}

@Injectable()
@Command({ name: 'analyze', description: 'Run an RCA for a time window' })
export class AnalyzeCommand extends CommandRunner {
  constructor(
    private readonly loop: ExpandLoopService,
    private readonly infra: InfraLoaderService,
  ) {
    super();
  }

  async run(_passed: string[], opts: AnalyzeArgs): Promise<void> {
    const code = await analyzeHandler(opts, {
      loop: this.loop,
      infra: this.infra,
      prompts: new FsPromptReader('/app/infra/prompts'),
      log: (msg) => console.log(msg),
    });
    process.exit(code);
  }

  @Option({ flags: '--from <iso>', required: true })
  parseFrom(v: string): string { return v; }
  @Option({ flags: '--to <iso>', required: true })
  parseTo(v: string): string { return v; }
  @Option({ flags: '--auto-expand', required: false })
  parseAuto(): boolean { return true; }
}
