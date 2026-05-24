import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { RcasRepo } from '../mongo/rcas.repo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CreateBody = z.object({
  from: z.string(),
  to: z.string(),
  autoExpand: z.boolean().default(false),
});

const ResolveBody = z.object({
  status: z.enum(['resolved', 'ignored']),
  note: z.string().optional(),
  steps: z.array(z.string()).default([]),
});

export interface PromptReader {
  read(componentName: string): string;
}

class FsPromptReader implements PromptReader {
  constructor(private readonly dir: string) {}
  read(componentName: string): string {
    return readFileSync(join(this.dir, `${componentName}.md`), 'utf8');
  }
}

@Controller('api')
export class RcaController {
  constructor(
    private readonly loop: ExpandLoopService,
    private readonly infra: InfraLoaderService,
    private readonly prompts: PromptReader,
    private readonly rcas?: RcasRepo,
  ) {}

  @Post('rca')
  async create(@Body() body: unknown) {
    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    if (new Date(parsed.data.from) >= new Date(parsed.data.to)) {
      throw new BadRequestException('"from" must be before "to"');
    }
    const components = this.infra.getComponents();
    const promptMdByComponent: Record<string, string> = {};
    for (const c of components) promptMdByComponent[c.name] = this.prompts.read(c.name);

    return this.loop.runCycle({
      trigger: 'manual',
      window: { from: parsed.data.from, to: parsed.data.to },
      components,
      promptMdByComponent,
      infraMd: this.infra.getProse(),
      dependencyGraph: this.infra.getDependencyGraph(),
      autoExpand: parsed.data.autoExpand,
    });
  }

  @Get('rcas')
  async list() {
    if (!this.rcas) return [];
    return this.rcas.list(50);
  }

  @Get('rcas/:id')
  async get(@Param('id') id: string) {
    if (!this.rcas) throw new NotFoundException();
    const r = await this.rcas.findById(id);
    if (!r) throw new NotFoundException();
    return r;
  }

  @Patch('rcas/:id/resolution')
  async resolve(@Param('id') id: string, @Body() body: unknown) {
    if (!this.rcas) throw new NotFoundException();
    const parsed = ResolveBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    if (parsed.data.status === 'resolved') {
      await this.rcas.markResolved(id, parsed.data.note ?? '', parsed.data.steps);
    } else {
      await this.rcas.markIgnored(id);
    }
    return { ok: true };
  }
}

export { FsPromptReader };
