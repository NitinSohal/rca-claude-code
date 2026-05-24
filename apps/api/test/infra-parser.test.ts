import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitInfraMarkdown, validateInfra } from '../src/infra/infra-parser';

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

describe('validateInfra', () => {
  it('fails on dangling depends_on', () => {
    expect(() => validateInfra(fix('dangling-dep.md'), { maxComponents: 20 })).toThrow(/b-does-not-exist/);
  });
  it('warns but does not fail on cycle', () => {
    const result = validateInfra(fix('cycle.md'), { maxComponents: 20 });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/cycle/i)]));
    expect(result.components).toHaveLength(2);
  });
  it('fails on component with no data source', () => {
    expect(() => validateInfra(fix('no-datasource.md'), { maxComponents: 20 })).toThrow(/data source/i);
  });
  it('fails when components exceed MAX_COMPONENTS', () => {
    expect(() => validateInfra(fix('two-components.md'), { maxComponents: 1 })).toThrow(/MAX_COMPONENTS/);
  });
});
