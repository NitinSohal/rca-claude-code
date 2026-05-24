import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InfraLoaderService } from '../src/infra/infra-loader.service';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'rca-infra-'));
}

const validMd = `# Infra

## Request flow
ALB → auth.

---

## Component: auth-service

\`\`\`yaml
name: auth-service
type: service
description: Validates JWTs
loki:
  selector: '{service="auth-service"}'
\`\`\`
`;

describe('InfraLoaderService', () => {
  it('loads and emits a prompt file for each component', () => {
    const dir = tmp();
    const mdPath = join(dir, 'infra.md');
    writeFileSync(mdPath, validMd);
    const promptsDir = join(dir, 'prompts');
    const loader = new InfraLoaderService({ infraMdPath: mdPath, promptsDir, maxComponents: 20 });
    loader.load();
    const files = readdirSync(promptsDir);
    expect(files).toContain('auth-service.md');
    const md = readFileSync(join(promptsDir, 'auth-service.md'), 'utf8');
    expect(md).toContain('name: auth-service-investigator');
    expect(loader.getComponents()).toHaveLength(1);
    expect(loader.getProse()).toContain('Request flow');
  });
  it('throws when file is missing', () => {
    const loader = new InfraLoaderService({ infraMdPath: '/no/such/file.md', promptsDir: tmp(), maxComponents: 20 });
    expect(() => loader.load()).toThrow();
  });
});
