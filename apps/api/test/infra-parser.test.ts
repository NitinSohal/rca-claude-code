import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitInfraMarkdown } from '../src/infra/infra-parser';

const fix = (n: string) => readFileSync(join(__dirname, 'fixtures/infra', n), 'utf8');

describe('splitInfraMarkdown', () => {
  it('extracts prose + one component from minimal.md', () => {
    const r = splitInfraMarkdown(fix('minimal.md'));
    expect(r.prose).toContain('Request flow');
    expect(r.components).toHaveLength(1);
    expect(r.components[0].name).toBe('auth-service');
    expect(r.components[0].yamlBlock).toContain('name: auth-service');
  });
  it('extracts two components in order', () => {
    const r = splitInfraMarkdown(fix('two-components.md'));
    expect(r.components.map((c) => c.name)).toEqual(['auth-service', 'postgres-primary']);
  });
  it('throws if a component section has no yaml fenced block', () => {
    expect(() => splitInfraMarkdown(fix('missing-yaml.md'))).toThrow(/no yaml block/i);
  });
  it('handles empty file as zero components', () => {
    const r = splitInfraMarkdown('# Just prose\n\nNothing else.\n');
    expect(r.components).toHaveLength(0);
    expect(r.prose).toContain('Just prose');
  });
});
