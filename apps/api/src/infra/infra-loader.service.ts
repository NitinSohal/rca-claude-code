import { Injectable } from '@nestjs/common';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Component } from '@rca/agent';
import { validateInfra } from './infra-parser';
import { renderSubagentPrompt, type PeerSummary } from './prompt-generator';

export interface InfraLoaderOptions {
  infraMdPath: string;
  promptsDir: string;
  maxComponents: number;
}

@Injectable()
export class InfraLoaderService {
  private prose = '';
  private components: Component[] = [];
  private warnings: string[] = [];

  constructor(private readonly opts: InfraLoaderOptions) {}

  load(): void {
    const md = readFileSync(this.opts.infraMdPath, 'utf8');
    const result = validateInfra(md, { maxComponents: this.opts.maxComponents });
    this.prose = result.prose;
    this.components = result.components;
    this.warnings = result.warnings;

    mkdirSync(this.opts.promptsDir, { recursive: true });
    const peerIndex: PeerSummary[] = this.components.map((c) => ({
      name: c.name,
      description: c.description,
    }));
    for (const c of this.components) {
      const md = renderSubagentPrompt({ component: c, prose: this.prose, peerIndex });
      writeFileSync(join(this.opts.promptsDir, `${c.name}.md`), md);
    }
  }

  getProse(): string { return this.prose; }
  getComponents(): Component[] { return this.components; }
  getWarnings(): string[] { return this.warnings; }
  getComponent(name: string): Component | undefined { return this.components.find((c) => c.name === name); }
  getDependencyGraph(): Record<string, string[]> {
    return Object.fromEntries(this.components.map((c) => [c.name, c.depends_on ?? []]));
  }
}
