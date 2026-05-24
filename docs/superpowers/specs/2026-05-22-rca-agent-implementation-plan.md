---
title: RCA Agent — Implementation Plan
date: 2026-05-22
owner: Nitin Sohal
spec: ./2026-05-22-rca-agent-design.md
---

# RCA Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `rca-claude-code` — a Next.js + NestJS + Claude Agent SDK system that, given a time window, runs one Claude subagent per infrastructure component in parallel, all data routed through a single Grafana service account, then synthesizes a structured root-cause analysis, persists it to MongoDB, and surfaces it on a dashboard with a persistent events panel.

**Architecture:** TypeScript monorepo (pnpm workspaces). `apps/api` is NestJS (controllers + coordinator + grafana client + mongo + outbound guard + nest-commander CLI). `apps/web` is Next.js App Router (dashboard + SSE). `apps/agent` is a shared TS package wrapping `@anthropic-ai/claude-agent-sdk` with a `ClaudeClient` interface (real + stub), Zod schemas, and prompt templates. Two Docker containers (`rca-api`, `rca-ui`) wired via Docker Compose. Claude auth = mounted `~/.claude` (no API key). All log/metric/cw queries go through `GET/POST /api/datasources/proxy/uid/<uid>/...` with a single bearer token.

**Tech Stack:** TypeScript 5.6, Node 22, pnpm 9, NestJS 10, Next.js 15 (App Router), `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/claude-code` (CLI, for auth), Zod 3, MongoDB driver 6, pino 9, Vitest 2, nock 13, mongodb-memory-server 10, undici (HTTP), js-yaml 4, Docker + Docker Compose, GitHub Actions.

---

## Source-of-truth references

Every task in this plan implements something from the design spec at `docs/superpowers/specs/2026-05-22-rca-agent-design.md`. When in doubt, the spec wins.

Spec section → plan phase map:

| Spec § | Title | Plan phase |
|---|---|---|
| §0 | Problem | Phase 0 (project framing) |
| §1.1–1.4 | Stack, repo layout | Phase 0, 13 |
| §1.5 | Entry points | Phase 10, 11, 14 |
| §1.6 | Env config | Phase 3, 13 |
| §1.7 | Data flow | Phase 8, 9 |
| §2 | infra.md format + parser | Phase 2 |
| §3.1 | Subagent prompt | Phase 2.6, 8 |
| §3.2 | Pre-fetched data | Phase 7, 8 |
| §3.3 | Coordinator | Phase 8 |
| §3.4 | Synthesizer | Phase 9 |
| §3.5 | Past-RCA lookup | Phase 9 |
| §3.6 | Token budget + caching | Phase 8.5 |
| §4.1–4.2 | Loop + stop hook | Phase 9 |
| §4.3–4.4 | Alert state + baseline | Phase 7, 9 |
| §4.5 | Failure modes | Phase 4, 6, 8, 9 |
| §4.6 | SSE | Phase 8.8, 10 |
| §4.7–4.8 | Expansion + concurrency | Phase 9 |
| §5.1–5.2 | OutboundCallGuard | Phase 4 |
| §5.3 | Logging | Phase 3 |
| §5.4 | Self-observability | Phase 5 (runs collection) |
| §5.5 | Secrets | Phase 13 |
| §5.6 | Down-dep UX | Phase 4, 6 |
| §5.8 | Healthz | Phase 3 |
| §5.9–5.11 | Events panel | Phase 6, 12 |
| §6.1–6.10 | Testing strategy | Every phase (TDD) |

---

## File-structure map

These are the files the plan will create. Tasks reference them by exact path.

```
rca-claude-code/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── vitest.workspace.ts
├── .env.example
├── docker-compose.yml
├── .github/workflows/ci.yml
├── infra/
│   ├── infra.md                       # user-provided; example committed
│   ├── infra.example.md               # canonical example for tests + readme
│   └── prompts/                       # generated at startup, gitignored
│
├── apps/
│   ├── agent/                         # shared TS package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── schemas/
│   │   │   │   ├── env.ts
│   │   │   │   ├── component.ts
│   │   │   │   ├── subagent-output.ts
│   │   │   │   ├── rca-output.ts
│   │   │   │   └── grafana.ts
│   │   │   ├── claude-client.ts       # ClaudeClient interface + RealClaudeClient
│   │   │   ├── stub-claude-client.ts  # for tests
│   │   │   ├── prompt-builder.ts      # subagent + synthesizer prompts
│   │   │   ├── lttb.ts                # downsampler
│   │   │   └── baseline.ts            # baseline detector
│   │   └── test/
│   │       ├── fixtures/
│   │       │   ├── grafana/loki-error-window.json
│   │       │   ├── grafana/prom-rate.json
│   │       │   ├── grafana/cw-cpu.json
│   │       │   ├── subagent/healthy.json
│   │       │   ├── subagent/degraded-postgres.json
│   │       │   ├── subagent/cascade.json
│   │       │   ├── subagent/inconclusive.json
│   │       │   └── synthesizer/cascade.json
│   │       ├── lttb.test.ts
│   │       ├── baseline.test.ts
│   │       ├── schemas.test.ts
│   │       ├── prompt-builder.test.ts
│   │       └── stub-claude-client.test.ts
│   │
│   ├── api/                           # NestJS
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── config/
│   │   │   │   ├── config.module.ts
│   │   │   │   └── config.service.ts
│   │   │   ├── logger/
│   │   │   │   └── pino-logger.ts
│   │   │   ├── guard/
│   │   │   │   ├── outbound-call-guard.ts
│   │   │   │   └── circuit-breaker.ts
│   │   │   ├── mongo/
│   │   │   │   ├── mongo.module.ts
│   │   │   │   ├── mongo.service.ts
│   │   │   │   ├── runs.repo.ts
│   │   │   │   ├── rcas.repo.ts
│   │   │   │   ├── events.repo.ts
│   │   │   │   ├── resolutions.repo.ts
│   │   │   │   └── alerts.repo.ts
│   │   │   ├── events/
│   │   │   │   ├── events.module.ts
│   │   │   │   ├── events.service.ts
│   │   │   │   └── events.controller.ts
│   │   │   ├── grafana/
│   │   │   │   ├── grafana.module.ts
│   │   │   │   ├── grafana.service.ts
│   │   │   │   └── datasource-discovery.ts
│   │   │   ├── infra/
│   │   │   │   ├── infra.module.ts
│   │   │   │   ├── infra-parser.ts
│   │   │   │   ├── prompt-generator.ts
│   │   │   │   └── infra-loader.service.ts
│   │   │   ├── coordinator/
│   │   │   │   ├── coordinator.module.ts
│   │   │   │   ├── coordinator.service.ts
│   │   │   │   ├── subagent-runner.ts
│   │   │   │   ├── prefetcher.ts
│   │   │   │   ├── dependency-bus.ts
│   │   │   │   └── stream.ts            # SSE bus
│   │   │   ├── synthesizer/
│   │   │   │   ├── synthesizer.module.ts
│   │   │   │   ├── synthesizer.service.ts
│   │   │   │   └── past-rca-lookup.ts
│   │   │   ├── stop-hook/
│   │   │   │   ├── stop-hook.module.ts
│   │   │   │   └── stop-hook.service.ts
│   │   │   ├── expand-loop/
│   │   │   │   ├── expand-loop.module.ts
│   │   │   │   └── expand-loop.service.ts
│   │   │   ├── slack/
│   │   │   │   ├── slack.module.ts
│   │   │   │   └── slack.service.ts
│   │   │   ├── rca/
│   │   │   │   ├── rca.module.ts
│   │   │   │   └── rca.controller.ts
│   │   │   ├── runs/
│   │   │   │   ├── runs.module.ts
│   │   │   │   └── runs.controller.ts        # SSE
│   │   │   ├── health/
│   │   │   │   ├── health.module.ts
│   │   │   │   └── health.controller.ts
│   │   │   ├── webhook/
│   │   │   │   ├── webhook.module.ts
│   │   │   │   └── webhook.controller.ts
│   │   │   └── cli/
│   │   │       ├── cli.module.ts
│   │   │       ├── analyze.command.ts
│   │   │       ├── health.command.ts
│   │   │       ├── resolve.command.ts
│   │   │       └── validate-infra.command.ts
│   │   └── test/
│   │       ├── fixtures/grafana/         # response shapes for nock
│   │       ├── fixtures/infra/           # markdown fixtures
│   │       ├── infra-parser.test.ts
│   │       ├── prompt-generator.test.ts
│   │       ├── grafana.service.test.ts
│   │       ├── outbound-call-guard.test.ts
│   │       ├── circuit-breaker.test.ts
│   │       ├── events.service.test.ts
│   │       ├── stop-hook.test.ts
│   │       ├── coordinator.test.ts
│   │       ├── synthesizer.test.ts
│   │       ├── expand-loop.test.ts
│   │       ├── slack.service.test.ts
│   │       ├── past-rca-lookup.test.ts
│   │       ├── health.controller.test.ts
│   │       ├── rca.controller.test.ts
│   │       ├── runs.sse.test.ts
│   │       ├── webhook.controller.test.ts
│   │       └── cli.test.ts
│   │
│   └── web/                            # Next.js
│       ├── package.json
│       ├── next.config.mjs
│       ├── tsconfig.json
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   ├── page.tsx                # redirects to /analyze
│       │   ├── analyze/page.tsx
│       │   ├── rcas/page.tsx
│       │   ├── rcas/[id]/page.tsx
│       │   ├── rcas/[id]/resolution/page.tsx
│       │   ├── runs/[id]/page.tsx      # live stream view
│       │   ├── events/page.tsx
│       │   ├── events/[id]/page.tsx
│       │   └── health/page.tsx
│       └── components/
│           ├── NotificationBell.tsx
│           ├── EventDrawer.tsx
│           ├── AnalyzeForm.tsx
│           ├── RcaList.tsx
│           ├── RcaDetail.tsx
│           ├── RunStream.tsx
│           └── HealthGrid.tsx
```

---

## Phase 0 — Monorepo skeleton

Bootstrap pnpm workspaces, TypeScript baseline, lint/format, Vitest workspace runner. Everything else depends on this.

### Task 0.1: Initialize pnpm workspace and root files

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.prettierrc`
- Create: `.eslintrc.cjs`

- [ ] **Step 1: Confirm Node + pnpm versions on dev machine**

Run: `node -v && pnpm -v`
Expected: `v22.x` and `9.x`. If pnpm missing: `npm i -g pnpm@9`.

- [ ] **Step 2: Write `.nvmrc`**

Content:
```
22
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

Content:
```yaml
packages:
  - "apps/*"
```

- [ ] **Step 4: Write root `package.json`**

Content:
```json
{
  "name": "rca-claude-code",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "build": "pnpm -r build",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "RCA_E2E=1 vitest run -t e2e",
    "validate-infra": "pnpm --filter @rca/api run validate-infra"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@typescript-eslint/eslint-plugin": "8.14.0",
    "@typescript-eslint/parser": "8.14.0",
    "eslint": "9.14.0",
    "eslint-config-prettier": "9.1.0",
    "prettier": "3.3.3",
    "typescript": "5.6.3",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 5: Write `tsconfig.base.json`**

Content:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true,
    "lib": ["ES2022"]
  },
  "exclude": ["node_modules", "dist", "build", ".next"]
}
```

- [ ] **Step 6: Write `.prettierrc`**

Content:
```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true
}
```

- [ ] **Step 7: Write `.eslintrc.cjs`**

Content:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist', 'build', '.next', 'node_modules', 'coverage'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
```

- [ ] **Step 8: Install root dev deps**

Run: `pnpm install`
Expected: pnpm creates `node_modules/`, `pnpm-lock.yaml`.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .nvmrc .prettierrc .eslintrc.cjs pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace + tsconfig baseline"
```

### Task 0.2: Vitest workspace configuration

**Files:**
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Write `vitest.workspace.ts`**

Content:
```ts
export default ['apps/agent', 'apps/api'];
```

- [ ] **Step 2: Run vitest to verify (will report 0 tests)**

Run: `pnpm test`
Expected: exits 0 with "No test files found" or runs zero tests across workspaces (whichever vitest does for empty workspaces).

- [ ] **Step 3: Commit**

```bash
git add vitest.workspace.ts
git commit -m "chore: add vitest workspace runner"
```

### Task 0.3: Create empty workspace packages

**Files:**
- Create: `apps/agent/package.json`
- Create: `apps/agent/tsconfig.json`
- Create: `apps/agent/src/index.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`

- [ ] **Step 1: Write `apps/agent/package.json`**

Content:
```json
{
  "name": "@rca/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "3.23.8"
  }
}
```

- [ ] **Step 2: Write `apps/agent/tsconfig.json`**

Content:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `apps/agent/src/index.ts`**

Content:
```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 4: Write `apps/api/package.json`**

Content:
```json
{
  "name": "@rca/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "cli": "tsx src/cli/cli.module.ts",
    "validate-infra": "tsx src/cli/cli.module.ts validate-infra"
  },
  "dependencies": {
    "@rca/agent": "workspace:*"
  },
  "devDependencies": {
    "tsx": "4.19.2"
  }
}
```

- [ ] **Step 5: Write `apps/api/tsconfig.json`**

Content:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Write `apps/api/src/main.ts`**

Content:
```ts
console.log('rca-api bootstrap placeholder');
```

- [ ] **Step 7: Write `apps/web/package.json`**

Content:
```json
{
  "name": "@rca/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 8: Write `apps/web/tsconfig.json`**

Content:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "allowJs": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 9: Install workspace deps**

Run: `pnpm install`
Expected: three packages discovered, links created.

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: passes (api and agent at least; web will skip since no next-env.d.ts yet — if it fails, add empty `apps/web/next-env.d.ts`).

- [ ] **Step 11: Commit**

```bash
git add apps/
git commit -m "chore: create agent/api/web workspace packages"
```

---

## Phase 1 — Shared schemas + ClaudeClient wrapper

`apps/agent` is the shared dependency for both `apps/api` and tests. Build the Zod schemas first (everything downstream uses them), then the `ClaudeClient` interface, then a deterministic `StubClaudeClient` for tests. This is the test-substitution seam that makes the whole project testable per spec §6.2.

### Task 1.1: Env schema

**Files:**
- Create: `apps/agent/src/schemas/env.ts`
- Test: `apps/agent/test/schemas.test.ts`

- [ ] **Step 1: Write failing test for `EnvSchema`**

File `apps/agent/test/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../src/schemas/env';

describe('EnvSchema', () => {
  it('accepts a minimal valid config', () => {
    const parsed = EnvSchema.parse({
      GRAFANA_URL: 'https://grafana.example.com',
      GRAFANA_SERVICE_ACCOUNT_TOKEN: 'glsa_xxx',
      MONGO_URI: 'mongodb://localhost:27017/rca',
    });
    expect(parsed.WINDOW_INITIAL_HOURS).toBe(4);
    expect(parsed.WINDOW_STEP_MINUTES).toBe(30);
    expect(parsed.WINDOW_MAX_HOURS).toBe(24);
    expect(parsed.RCA_CONFIDENCE_THRESHOLD).toBe(0.75);
    expect(parsed.BASELINE_TOLERANCE).toBe(0.2);
    expect(parsed.MAX_COMPONENTS).toBe(20);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.LOG_SUCCESSES).toBe(false);
    expect(parsed.INFRA_MD_PATH).toBe('/app/infra/infra.md');
    expect(parsed.CLAUDE_CONFIG_DIR).toBe('/root/.claude');
  });

  it('rejects when required vars are missing', () => {
    expect(() => EnvSchema.parse({})).toThrow();
  });

  it('coerces numeric env vars', () => {
    const parsed = EnvSchema.parse({
      GRAFANA_URL: 'https://g',
      GRAFANA_SERVICE_ACCOUNT_TOKEN: 't',
      MONGO_URI: 'mongodb://x',
      WINDOW_INITIAL_HOURS: '6',
      RCA_CONFIDENCE_THRESHOLD: '0.9',
    });
    expect(parsed.WINDOW_INITIAL_HOURS).toBe(6);
    expect(parsed.RCA_CONFIDENCE_THRESHOLD).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run test, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/agent/src/schemas/env.ts`**

Content:
```ts
import { z } from 'zod';

const num = (def: number) =>
  z.coerce.number().default(def);

export const EnvSchema = z.object({
  GRAFANA_URL: z.string().url(),
  GRAFANA_SERVICE_ACCOUNT_TOKEN: z.string().min(1),
  LOKI_DATASOURCE_UID: z.string().optional(),
  PROM_DATASOURCE_UID: z.string().optional(),
  CW_DATASOURCE_UID: z.string().optional(),
  MONGO_URI: z.string().min(1),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  WINDOW_INITIAL_HOURS: num(4),
  WINDOW_STEP_MINUTES: num(30),
  WINDOW_MAX_HOURS: num(24),
  RCA_CONFIDENCE_THRESHOLD: num(0.75),
  BASELINE_TOLERANCE: num(0.2),
  BACKOFF_MS: num(5000),
  MAX_COMPONENTS: num(20),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_SUCCESSES: z.coerce.boolean().default(false),
  INFRA_MD_PATH: z.string().default('/app/infra/infra.md'),
  CLAUDE_CONFIG_DIR: z.string().default('/root/.claude'),
  PORT: num(8080),
});

export type Env = z.infer<typeof EnvSchema>;
```

- [ ] **Step 4: Run test, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/schemas/env.ts apps/agent/test/schemas.test.ts
git commit -m "feat(agent): zod env schema"
```

### Task 1.2: Component YAML schema

Implements spec §2.2.

**Files:**
- Create: `apps/agent/src/schemas/component.ts`
- Modify: `apps/agent/test/schemas.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `apps/agent/test/schemas.test.ts`:
```ts
import { ComponentSchema } from '../src/schemas/component';

describe('ComponentSchema', () => {
  const base = {
    name: 'auth-service',
    type: 'service' as const,
    description: 'Validates JWTs',
    loki: { selector: '{service="auth-service"}' },
  };

  it('accepts a minimal service component with loki', () => {
    expect(() => ComponentSchema.parse(base)).not.toThrow();
  });

  it('rejects if no data source is configured', () => {
    expect(() =>
      ComponentSchema.parse({
        name: 'x',
        type: 'service',
        description: 'd',
      }),
    ).toThrow(/at least one data source/);
  });

  it('rejects non-kebab-case names', () => {
    expect(() => ComponentSchema.parse({ ...base, name: 'AuthService' })).toThrow();
    expect(() => ComponentSchema.parse({ ...base, name: 'auth_service' })).toThrow();
  });

  it('accepts depends_on as a list of names', () => {
    const parsed = ComponentSchema.parse({ ...base, depends_on: ['postgres-primary', 'redis-cache'] });
    expect(parsed.depends_on).toEqual(['postgres-primary', 'redis-cache']);
  });

  it('accepts full prometheus + cloudwatch config', () => {
    expect(() =>
      ComponentSchema.parse({
        ...base,
        prometheus: { metrics: [{ name: 'request_rate', query: 'sum(rate(x[5m]))' }] },
        cloudwatch: {
          namespace: 'AWS/ECS',
          dimensions: { ClusterName: 'prod', ServiceName: 'auth' },
          metrics: ['CPUUtilization'],
        },
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/agent/src/schemas/component.ts`**

Content:
```ts
import { z } from 'zod';

const kebab = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, 'must be kebab-case');

export const ComponentTypeSchema = z.enum([
  'service',
  'datastore',
  'queue',
  'cache',
  'external',
]);

export const LokiConfigSchema = z.object({
  selector: z.string().min(1),
  error_filter: z.string().optional(),
});

export const PromMetricSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
});

export const PrometheusConfigSchema = z.object({
  metrics: z.array(PromMetricSchema).min(1),
});

export const CloudWatchConfigSchema = z.object({
  namespace: z.string().min(1),
  dimensions: z.record(z.string(), z.string()),
  metrics: z.array(z.string().min(1)).min(1),
});

export const ComponentSchema = z
  .object({
    name: kebab,
    type: ComponentTypeSchema,
    description: z.string().min(1),
    loki: LokiConfigSchema.optional(),
    prometheus: PrometheusConfigSchema.optional(),
    cloudwatch: CloudWatchConfigSchema.optional(),
    depends_on: z.array(kebab).optional(),
    runbook_url: z.string().url().optional(),
  })
  .refine(
    (c) => Boolean(c.loki || c.prometheus || c.cloudwatch),
    { message: 'Component must declare at least one data source (loki, prometheus, or cloudwatch)' },
  );

export type Component = z.infer<typeof ComponentSchema>;
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/schemas/component.ts apps/agent/test/schemas.test.ts
git commit -m "feat(agent): zod component schema with data-source guard"
```

### Task 1.3: Subagent + RCA output schemas

Implements spec §3.1 + §3.4.

**Files:**
- Create: `apps/agent/src/schemas/subagent-output.ts`
- Create: `apps/agent/src/schemas/rca-output.ts`
- Modify: `apps/agent/test/schemas.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `apps/agent/test/schemas.test.ts`:
```ts
import { SubagentOutputSchema } from '../src/schemas/subagent-output';
import { RcaOutputSchema } from '../src/schemas/rca-output';

describe('SubagentOutputSchema', () => {
  it('accepts a healthy minimal output', () => {
    const ok = SubagentOutputSchema.parse({
      component: 'auth-service',
      status: 'healthy',
      confidence: 0.95,
      findings: [],
      suspected_dependencies: [],
      notes: 'nothing unusual',
    });
    expect(ok.status).toBe('healthy');
  });

  it('rejects confidence > 1', () => {
    expect(() =>
      SubagentOutputSchema.parse({
        component: 'x',
        status: 'failed',
        confidence: 1.5,
        findings: [],
        suspected_dependencies: [],
        notes: '',
      }),
    ).toThrow();
  });

  it('requires findings[].evidence[] shape', () => {
    expect(() =>
      SubagentOutputSchema.parse({
        component: 'x',
        status: 'failed',
        confidence: 0.5,
        findings: [{ summary: 's', severity: 'error', evidence: [{ type: 'log' }] }],
        suspected_dependencies: [],
        notes: '',
      }),
    ).toThrow();
  });
});

describe('RcaOutputSchema', () => {
  it('accepts a full RCA payload', () => {
    expect(() =>
      RcaOutputSchema.parse({
        summary: 's',
        root_cause: { component: 'postgres-primary', description: 'd', confidence: 0.8 },
        contributing_factors: [],
        timeline: [{ ts: '2026-05-22T09:12:30Z', event: 'connection pool exhausted' }],
        evidence: [{ component: 'postgres-primary', type: 'metric', ref: 'pg_active', excerpt: '100/100' }],
        suggested_next_steps: ['raise pool'],
        similar_past_rcas: [],
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/agent/src/schemas/subagent-output.ts`**

Content:
```ts
import { z } from 'zod';

export const EvidenceSchema = z.object({
  type: z.enum(['log', 'metric', 'cw']),
  ref: z.string(),
  value: z.string(),
});

export const FindingSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(EvidenceSchema),
  severity: z.enum(['info', 'warn', 'error', 'critical']),
});

export const SubagentStatusSchema = z.enum(['healthy', 'degraded', 'failed', 'inconclusive']);

export const SubagentOutputSchema = z.object({
  component: z.string().min(1),
  status: SubagentStatusSchema,
  confidence: z.number().min(0).max(1),
  findings: z.array(FindingSchema),
  suspected_dependencies: z.array(z.string()),
  notes: z.string().max(2000),
});

export type SubagentOutput = z.infer<typeof SubagentOutputSchema>;
```

- [ ] **Step 4: Write `apps/agent/src/schemas/rca-output.ts`**

Content:
```ts
import { z } from 'zod';

export const RootCauseSchema = z.object({
  component: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
});

export const ContributingFactorSchema = z.object({
  component: z.string(),
  description: z.string(),
  severity: z.enum(['info', 'warn', 'error', 'critical']),
});

export const TimelineEntrySchema = z.object({
  ts: z.string(),
  event: z.string(),
});

export const RcaEvidenceSchema = z.object({
  component: z.string(),
  type: z.enum(['log', 'metric', 'cw']),
  ref: z.string(),
  excerpt: z.string(),
});

export const RcaOutputSchema = z.object({
  summary: z.string(),
  root_cause: RootCauseSchema,
  contributing_factors: z.array(ContributingFactorSchema),
  timeline: z.array(TimelineEntrySchema),
  evidence: z.array(RcaEvidenceSchema),
  suggested_next_steps: z.array(z.string()),
  similar_past_rcas: z.array(z.string()),
});

export type RcaOutput = z.infer<typeof RcaOutputSchema>;
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 6: Re-export schemas from `apps/agent/src/index.ts`**

Replace file content:
```ts
export const VERSION = '0.1.0';
export * from './schemas/env';
export * from './schemas/component';
export * from './schemas/subagent-output';
export * from './schemas/rca-output';
```

- [ ] **Step 7: Commit**

```bash
git add apps/agent/src/schemas/ apps/agent/src/index.ts apps/agent/test/schemas.test.ts
git commit -m "feat(agent): zod schemas for subagent + rca output"
```

### Task 1.4: LTTB downsampler

Implements spec §3.2 ("metrics downsampled to ≤100 points per series").

**Files:**
- Create: `apps/agent/src/lttb.ts`
- Test: `apps/agent/test/lttb.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/agent/test/lttb.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { lttb } from '../src/lttb';

type Pt = [number, number];

describe('lttb', () => {
  it('returns input unchanged when length <= threshold', () => {
    const pts: Pt[] = [[1, 10], [2, 20], [3, 30]];
    expect(lttb(pts, 100)).toEqual(pts);
  });

  it('downsamples to exactly threshold points', () => {
    const pts: Pt[] = Array.from({ length: 1000 }, (_, i) => [i, Math.sin(i / 50)]);
    const out = lttb(pts, 100);
    expect(out.length).toBe(100);
  });

  it('preserves first and last point', () => {
    const pts: Pt[] = Array.from({ length: 500 }, (_, i) => [i, i * 2]);
    const out = lttb(pts, 50);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([499, 998]);
  });

  it('rejects threshold < 3 by returning input', () => {
    const pts: Pt[] = Array.from({ length: 10 }, (_, i) => [i, i]);
    expect(lttb(pts, 2)).toEqual(pts);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `apps/agent/src/lttb.ts`**

Content:
```ts
export type Point = [ts: number, value: number];

export function lttb(data: Point[], threshold: number): Point[] {
  if (threshold >= data.length || threshold < 3) return data;

  const sampled: Point[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  let a = 0;
  sampled.push(data[a]!);

  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

    let avgX = 0;
    let avgY = 0;
    const avgRangeLength = rangeEnd - rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += data[j]![0];
      avgY += data[j]![1];
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const pointAStart = Math.floor(i * bucketSize) + 1;
    const pointABucketEnd = Math.floor((i + 1) * bucketSize) + 1;
    const pointAX = data[a]![0];
    const pointAY = data[a]![1];

    let maxArea = -1;
    let maxAreaIdx = pointAStart;
    for (let j = pointAStart; j < pointABucketEnd; j++) {
      const area = Math.abs(
        (pointAX - avgX) * (data[j]![1] - pointAY) -
          (pointAX - data[j]![0]) * (avgY - pointAY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }
    sampled.push(data[maxAreaIdx]!);
    a = maxAreaIdx;
  }

  sampled.push(data[data.length - 1]!);
  return sampled;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/lttb.ts apps/agent/test/lttb.test.ts
git commit -m "feat(agent): LTTB metric downsampler"
```

### Task 1.5: Baseline detector

Implements spec §4.4.

**Files:**
- Create: `apps/agent/src/baseline.ts`
- Test: `apps/agent/test/baseline.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/agent/test/baseline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectMetricBackToBaseline } from '../src/baseline';

describe('detectMetricBackToBaseline', () => {
  const tolerance = 0.2;

  it('relative mode: current within tolerance of baseline → true', () => {
    const r = detectMetricBackToBaseline({
      baselineAvg: 100,
      currentAvg: 110,
      peak: 800,
      tolerance,
    });
    expect(r.metricBack).toBe(true);
    expect(r.mode).toBe('relative');
  });

  it('relative mode: current way over baseline → false', () => {
    const r = detectMetricBackToBaseline({
      baselineAvg: 100,
      currentAvg: 400,
      peak: 800,
      tolerance,
    });
    expect(r.metricBack).toBe(false);
  });

  it('absolute mode triggers when baseline is < 5% of peak', () => {
    const r = detectMetricBackToBaseline({
      baselineAvg: 0,
      currentAvg: 5,
      peak: 1000,
      tolerance,
    });
    expect(r.mode).toBe('absolute');
    expect(r.metricBack).toBe(true);
  });

  it('absolute mode: current >= 1% of peak → false', () => {
    const r = detectMetricBackToBaseline({
      baselineAvg: 0,
      currentAvg: 50,
      peak: 1000,
      tolerance,
    });
    expect(r.mode).toBe('absolute');
    expect(r.metricBack).toBe(false);
  });

  it('peak == 0 (no signal at all) → metricBack=true', () => {
    const r = detectMetricBackToBaseline({
      baselineAvg: 0,
      currentAvg: 0,
      peak: 0,
      tolerance,
    });
    expect(r.metricBack).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/agent/src/baseline.ts`**

Content:
```ts
export interface BaselineInput {
  baselineAvg: number;
  currentAvg: number;
  peak: number;
  tolerance: number;
}

export interface BaselineResult {
  metricBack: boolean;
  mode: 'relative' | 'absolute';
  ratio: number;
}

export function detectMetricBackToBaseline(input: BaselineInput): BaselineResult {
  const { baselineAvg, currentAvg, peak, tolerance } = input;

  if (peak === 0) return { metricBack: true, mode: 'absolute', ratio: 0 };

  const useRelative = baselineAvg > 0.05 * peak;
  if (useRelative) {
    const ratio = Math.abs(currentAvg - baselineAvg) / baselineAvg;
    return { metricBack: ratio <= tolerance, mode: 'relative', ratio };
  }

  const ratio = peak === 0 ? 0 : currentAvg / peak;
  return { metricBack: ratio < 0.01, mode: 'absolute', ratio };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/baseline.ts apps/agent/test/baseline.test.ts
git commit -m "feat(agent): baseline detector (relative + absolute modes)"
```

### Task 1.6: ClaudeClient interface + StubClaudeClient

Implements spec §6.2 — the test seam for the entire system.

**Files:**
- Create: `apps/agent/src/claude-client.ts`
- Create: `apps/agent/src/stub-claude-client.ts`
- Test: `apps/agent/test/stub-claude-client.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/agent/test/stub-claude-client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { StubClaudeClient } from '../src/stub-claude-client';

describe('StubClaudeClient', () => {
  it('routes by agentName to the matching responder', async () => {
    const stub = new StubClaudeClient({
      'auth-service-investigator': () => ({
        component: 'auth-service',
        status: 'healthy',
        confidence: 0.9,
        findings: [],
        suspected_dependencies: [],
        notes: '',
      }),
    });
    const out = await stub.run({
      agentName: 'auth-service-investigator',
      systemPrompt: '...',
      userPayload: { window: { from: 'a', to: 'b' }, loki: {}, prometheus: {}, cloudwatch: {} },
    });
    expect(JSON.parse(out.text).status).toBe('healthy');
    expect(out.tokensIn).toBeGreaterThan(0);
    expect(out.tokensOut).toBeGreaterThan(0);
  });

  it('throws when no responder is registered', async () => {
    const stub = new StubClaudeClient({});
    await expect(
      stub.run({ agentName: 'missing', systemPrompt: '', userPayload: {} }),
    ).rejects.toThrow(/no responder/i);
  });

  it('respects async responders that delay', async () => {
    const stub = new StubClaudeClient({
      slow: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true };
      },
    });
    const out = await stub.run({ agentName: 'slow', systemPrompt: '', userPayload: {} });
    expect(JSON.parse(out.text).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/agent/src/claude-client.ts`**

Content:
```ts
export interface ClaudeRunInput {
  agentName: string;
  systemPrompt: string;
  userPayload: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ClaudeRunResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
}

export interface ClaudeClient {
  run(input: ClaudeRunInput): Promise<ClaudeRunResult>;
}

export const CLAUDE_CLIENT = Symbol.for('ClaudeClient');
```

- [ ] **Step 4: Write `apps/agent/src/stub-claude-client.ts`**

Content:
```ts
import type { ClaudeClient, ClaudeRunInput, ClaudeRunResult } from './claude-client';

export type StubResponder = (input: ClaudeRunInput) => unknown | Promise<unknown>;

export class StubClaudeClient implements ClaudeClient {
  constructor(private readonly responders: Record<string, StubResponder>) {}

  async run(input: ClaudeRunInput): Promise<ClaudeRunResult> {
    const responder = this.responders[input.agentName];
    if (!responder) throw new Error(`No responder for agent: ${input.agentName}`);
    const started = Date.now();
    const result = await responder(input);
    const text = JSON.stringify(result);
    return {
      text,
      tokensIn: 100,
      tokensOut: text.length / 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: Date.now() - started,
    };
  }
}
```

- [ ] **Step 5: Re-export from `apps/agent/src/index.ts`**

Append to the file:
```ts
export * from './claude-client';
export * from './stub-claude-client';
export * from './lttb';
export * from './baseline';
```

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/agent/src/claude-client.ts apps/agent/src/stub-claude-client.ts apps/agent/src/index.ts apps/agent/test/stub-claude-client.test.ts
git commit -m "feat(agent): ClaudeClient interface + deterministic StubClaudeClient"
```

### Task 1.7: Real Claude client (wired to SDK)

Real implementation of the same interface. Tests assert it calls `query()` correctly; integration uses the stub.

**Files:**
- Modify: `apps/agent/package.json` (add `@anthropic-ai/claude-agent-sdk`)
- Create: `apps/agent/src/real-claude-client.ts`
- Test: `apps/agent/test/real-claude-client.test.ts`

- [ ] **Step 1: Add the SDK dep**

Run: `pnpm --filter @rca/agent add @anthropic-ai/claude-agent-sdk@^0.1.0`
Expected: installed; package.json shows it under deps.

- [ ] **Step 2: Write failing test**

File `apps/agent/test/real-claude-client.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { RealClaudeClient } from '../src/real-claude-client';

describe('RealClaudeClient', () => {
  it('passes prompt + system + agent name to the underlying query function', async () => {
    const fakeMessages = [
      { type: 'assistant', message: { content: [{ type: 'text', text: '{"status":"healthy"}' }] } },
      { type: 'result', subtype: 'success', total_cost_usd: 0.01, usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    ];
    const queryFn = vi.fn().mockImplementation(async function* () {
      for (const m of fakeMessages) yield m;
    });
    const client = new RealClaudeClient({ queryFn, defaultModel: 'claude-sonnet-4-6' });
    const out = await client.run({
      agentName: 'auth-service-investigator',
      systemPrompt: 'You are an SRE...',
      userPayload: { window: { from: 'a', to: 'b' } },
    });
    expect(out.text).toBe('{"status":"healthy"}');
    expect(out.tokensIn).toBe(500);
    expect(out.tokensOut).toBe(50);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const call = queryFn.mock.calls[0][0];
    expect(call.options.systemPrompt).toContain('SRE');
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL.

- [ ] **Step 4: Write `apps/agent/src/real-claude-client.ts`**

Content:
```ts
import type { ClaudeClient, ClaudeRunInput, ClaudeRunResult } from './claude-client';

interface QueryFnArg {
  prompt: string;
  options: {
    systemPrompt?: string;
    model?: string;
    maxTurns?: number;
    abortController?: AbortController;
  };
}

interface AssistantMessage {
  type: 'assistant';
  message: { content: Array<{ type: string; text?: string }> };
}
interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}
type AnyMessage = AssistantMessage | ResultMessage | { type: string };

export type QueryFn = (arg: QueryFnArg) => AsyncIterable<AnyMessage>;

export interface RealClaudeClientOptions {
  queryFn: QueryFn;
  defaultModel?: string;
  maxTurns?: number;
}

export class RealClaudeClient implements ClaudeClient {
  constructor(private readonly opts: RealClaudeClientOptions) {}

  async run(input: ClaudeRunInput): Promise<ClaudeRunResult> {
    const started = Date.now();
    const ac = new AbortController();
    if (input.signal) input.signal.addEventListener('abort', () => ac.abort());
    if (input.timeoutMs) setTimeout(() => ac.abort(), input.timeoutMs);

    const stream = this.opts.queryFn({
      prompt: JSON.stringify(input.userPayload),
      options: {
        systemPrompt: input.systemPrompt,
        model: this.opts.defaultModel ?? 'claude-sonnet-4-6',
        maxTurns: this.opts.maxTurns ?? 8,
        abortController: ac,
      },
    });

    let text = '';
    let usage: ResultMessage['usage'] | undefined;
    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        for (const block of (msg as AssistantMessage).message.content) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      } else if (msg.type === 'result') {
        usage = (msg as ResultMessage).usage;
      }
    }

    return {
      text: text.trim(),
      tokensIn: usage?.input_tokens ?? 0,
      tokensOut: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - started,
    };
  }
}
```

- [ ] **Step 5: Re-export**

Append to `apps/agent/src/index.ts`:
```ts
export * from './real-claude-client';
```

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/agent/package.json apps/agent/src/real-claude-client.ts apps/agent/src/index.ts apps/agent/test/real-claude-client.test.ts pnpm-lock.yaml
git commit -m "feat(agent): RealClaudeClient wired to Agent SDK query()"
```

---

## Phase 2 — infra.md parser, validator, prompt generator

Implements spec §2 entirely. The parser is the gatekeeper for the system — bad infra.md must fail container start with a clear error per §2.5.

### Task 2.1: Section splitter

Splits an infra.md string into `{ prose, components: Array<{ name, yamlBlock }> }`.

**Files:**
- Create: `apps/api/src/infra/infra-parser.ts`
- Create: `apps/api/test/fixtures/infra/minimal.md`
- Create: `apps/api/test/fixtures/infra/two-components.md`
- Create: `apps/api/test/fixtures/infra/missing-yaml.md`
- Test: `apps/api/test/infra-parser.test.ts`

- [ ] **Step 1: Add `js-yaml` dep**

Run: `pnpm --filter @rca/api add js-yaml@4.1.0 && pnpm --filter @rca/api add -D @types/js-yaml@4.0.9`
Expected: installed.

- [ ] **Step 2: Write fixture `apps/api/test/fixtures/infra/minimal.md`**

Content:
```markdown
# Infra overview

## Request flow
ALB → auth-service → payments-api.

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs
loki:
  selector: '{service="auth-service"}'
```
```

- [ ] **Step 3: Write fixture `apps/api/test/fixtures/infra/two-components.md`**

Content:
```markdown
# Infra overview

## Request flow
Two-service system.

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs
loki:
  selector: '{service="auth-service"}'
depends_on: [postgres-primary]
```

## Component: postgres-primary

```yaml
name: postgres-primary
type: datastore
description: Primary Postgres
prometheus:
  metrics:
    - name: connections
      query: 'pg_stat_activity_count'
```
```

- [ ] **Step 4: Write fixture `apps/api/test/fixtures/infra/missing-yaml.md`**

Content:
```markdown
# Infra

## Component: lonely

This component has no yaml block.
```

- [ ] **Step 5: Write failing test**

File `apps/api/test/infra-parser.test.ts`:
```ts
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
```

- [ ] **Step 6: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 7: Write `apps/api/src/infra/infra-parser.ts`**

Content:
```ts
import { load as parseYaml } from 'js-yaml';
import { ComponentSchema, type Component } from '@rca/agent';

export interface ParsedComponent {
  name: string;
  yamlBlock: string;
}

export interface SplitInfra {
  prose: string;
  components: ParsedComponent[];
}

const HEADER_RE = /^## Component: (.+)$/gm;
const YAML_FENCE_RE = /```yaml\s*\n([\s\S]*?)\n```/m;

export function splitInfraMarkdown(md: string): SplitInfra {
  const matches = Array.from(md.matchAll(HEADER_RE));
  if (matches.length === 0) return { prose: md.trim(), components: [] };

  const firstStart = matches[0]!.index!;
  const prose = md.slice(0, firstStart).trim();

  const components: ParsedComponent[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const section = md.slice(start, end);
    const name = matches[i]![1]!.trim();
    const yamlMatch = section.match(YAML_FENCE_RE);
    if (!yamlMatch) throw new Error(`Component "${name}" has no yaml block`);
    components.push({ name, yamlBlock: yamlMatch[1]! });
  }
  return { prose, components };
}

export interface ValidatedInfra {
  prose: string;
  components: Component[];
}

export function parseInfraMarkdown(md: string): ValidatedInfra {
  const { prose, components } = splitInfraMarkdown(md);
  const out: Component[] = [];
  for (const c of components) {
    let parsed: unknown;
    try {
      parsed = parseYaml(c.yamlBlock);
    } catch (err) {
      throw new Error(`Component "${c.name}": yaml parse error: ${(err as Error).message}`);
    }
    const result = ComponentSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Component "${c.name}": ${issues}`);
    }
    if (result.data.name !== c.name) {
      throw new Error(
        `Component header "${c.name}" does not match yaml name "${result.data.name}"`,
      );
    }
    out.push(result.data);
  }
  return { prose, components: out };
}
```

- [ ] **Step 8: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/infra/infra-parser.ts apps/api/test/fixtures/infra/ apps/api/test/infra-parser.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): infra.md section splitter + zod-validated parser"
```

### Task 2.2: Full validation — dangling refs, cycles, MAX_COMPONENTS

**Files:**
- Modify: `apps/api/src/infra/infra-parser.ts` (add `validateInfra`)
- Create: `apps/api/test/fixtures/infra/dangling-dep.md`
- Create: `apps/api/test/fixtures/infra/cycle.md`
- Create: `apps/api/test/fixtures/infra/no-datasource.md`
- Modify: `apps/api/test/infra-parser.test.ts` (append)

- [ ] **Step 1: Write fixture `apps/api/test/fixtures/infra/dangling-dep.md`**

Content:
```markdown
# Infra

## Component: a

```yaml
name: a
type: service
description: A
loki:
  selector: '{a}'
depends_on: [b-does-not-exist]
```
```

- [ ] **Step 2: Write fixture `apps/api/test/fixtures/infra/cycle.md`**

Content:
```markdown
# Infra

## Component: a

```yaml
name: a
type: service
description: A
loki:
  selector: '{a}'
depends_on: [b]
```

## Component: b

```yaml
name: b
type: service
description: B
loki:
  selector: '{b}'
depends_on: [a]
```
```

- [ ] **Step 3: Write fixture `apps/api/test/fixtures/infra/no-datasource.md`**

Content:
```markdown
# Infra

## Component: bare

```yaml
name: bare
type: service
description: Has no data sources
```
```

- [ ] **Step 4: Append failing tests**

Append to `apps/api/test/infra-parser.test.ts`:
```ts
import { validateInfra } from '../src/infra/infra-parser';

describe('validateInfra', () => {
  it('fails on dangling depends_on', () => {
    expect(() => validateInfra(fix('dangling-dep.md'), { maxComponents: 20 })).toThrow(
      /b-does-not-exist/,
    );
  });

  it('warns but does not fail on cycle', () => {
    const result = validateInfra(fix('cycle.md'), { maxComponents: 20 });
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/cycle/i)]),
    );
    expect(result.components).toHaveLength(2);
  });

  it('fails on component with no data source', () => {
    expect(() => validateInfra(fix('no-datasource.md'), { maxComponents: 20 })).toThrow(
      /data source/i,
    );
  });

  it('fails when components exceed MAX_COMPONENTS', () => {
    expect(() => validateInfra(fix('two-components.md'), { maxComponents: 1 })).toThrow(
      /MAX_COMPONENTS/,
    );
  });
});
```

- [ ] **Step 5: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 6: Append `validateInfra` to `apps/api/src/infra/infra-parser.ts`**

Append:
```ts
export interface ValidationOptions {
  maxComponents: number;
}

export interface ValidationResult extends ValidatedInfra {
  warnings: string[];
}

export function validateInfra(md: string, opts: ValidationOptions): ValidationResult {
  const { prose, components } = parseInfraMarkdown(md);

  if (components.length > opts.maxComponents) {
    throw new Error(
      `MAX_COMPONENTS exceeded: ${components.length} > ${opts.maxComponents}`,
    );
  }

  const names = new Set(components.map((c) => c.name));
  for (const c of components) {
    for (const dep of c.depends_on ?? []) {
      if (!names.has(dep)) {
        throw new Error(`Component "${c.name}" depends_on unknown component "${dep}"`);
      }
    }
  }

  const cycles = findCycles(components);
  const warnings = cycles.map((c) => `cycle in depends_on: ${c.join(' → ')}`);

  return { prose, components, warnings };
}

function findCycles(components: Component[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const c of components) graph.set(c.name, c.depends_on ?? []);

  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  components.forEach((c) => color.set(c.name, WHITE));

  function dfs(node: string, stack: string[]): void {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (c === WHITE) {
        dfs(next, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const c of components) {
    if ((color.get(c.name) ?? WHITE) === WHITE) dfs(c.name, []);
  }
  return cycles;
}
```

- [ ] **Step 7: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/infra/infra-parser.ts apps/api/test/fixtures/infra/ apps/api/test/infra-parser.test.ts
git commit -m "feat(api): infra validation - dangling refs, cycles, MAX_COMPONENTS"
```

### Task 2.3: Prompt-file generator

Per spec §2.5 step 6 and §3.1 — generate `infra/prompts/<component>.md` from validated infra.

**Files:**
- Create: `apps/api/src/infra/prompt-generator.ts`
- Test: `apps/api/test/prompt-generator.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/prompt-generator.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderSubagentPrompt } from '../src/infra/prompt-generator';

const components = [
  {
    name: 'auth-service',
    type: 'service' as const,
    description: 'Validates JWTs',
    loki: { selector: '{service="auth-service"}' },
    depends_on: ['postgres-primary'],
  },
  {
    name: 'postgres-primary',
    type: 'datastore' as const,
    description: 'Primary postgres',
    prometheus: { metrics: [{ name: 'connections', query: 'pg_stat_activity_count' }] },
  },
];

describe('renderSubagentPrompt', () => {
  it('includes the frontmatter with subagent name, description and tool list', () => {
    const md = renderSubagentPrompt({
      component: components[0]!,
      prose: 'Prose body.',
      peerIndex: [{ name: 'postgres-primary', description: 'Primary postgres' }],
    });
    expect(md).toMatch(/^---\nname: auth-service-investigator/);
    expect(md).toContain('description: Investigates the auth-service component');
    expect(md).toContain('- grafana_query_loki');
    expect(md).toContain('- grafana_query_prom');
    expect(md).toContain('- grafana_query_cloudwatch');
    expect(md).toContain('- lookup_dependency');
    expect(md).toContain('model: claude-sonnet-4-6');
  });

  it('embeds the prose and component yaml', () => {
    const md = renderSubagentPrompt({
      component: components[0]!,
      prose: 'PROSE-HERE',
      peerIndex: [{ name: 'postgres-primary', description: 'Primary postgres' }],
    });
    expect(md).toContain('PROSE-HERE');
    expect(md).toContain('name: auth-service');
    expect(md).toContain('postgres-primary: Primary postgres');
  });

  it('does not list the component itself in the peer index', () => {
    const md = renderSubagentPrompt({
      component: components[0]!,
      prose: 'p',
      peerIndex: [{ name: 'postgres-primary', description: 'd' }],
    });
    expect(md).not.toMatch(/^- auth-service:/m);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/infra/prompt-generator.ts`**

Content:
```ts
import { dump as dumpYaml } from 'js-yaml';
import type { Component } from '@rca/agent';

export interface PeerSummary {
  name: string;
  description: string;
}

export interface RenderInput {
  component: Component;
  prose: string;
  peerIndex: PeerSummary[];
}

export function renderSubagentPrompt({ component, prose, peerIndex }: RenderInput): string {
  const yamlBlock = dumpYaml(component, { lineWidth: 120 });
  const peerList = peerIndex
    .filter((p) => p.name !== component.name)
    .map((p) => `- ${p.name}: ${p.description}`)
    .join('\n');

  return `---
name: ${component.name}-investigator
description: Investigates the ${component.name} component for the given time window
tools:
  - grafana_query_loki
  - grafana_query_prom
  - grafana_query_cloudwatch
  - lookup_dependency
model: claude-sonnet-4-6
---

You are an SRE investigator for ONE component: **${component.name}**.

# Your context (cached)
${prose}

# Other components (for reference only — use lookup_dependency if needed)
${peerList || '(none)'}

# YOUR component
\`\`\`yaml
${yamlBlock.trim()}
\`\`\`

# Your job
For the time window {{from}} → {{to}}:
1. Use the pre-fetched data injected at runtime under "# Pre-fetched data".
2. If pre-fetched data is inconclusive, use your tools to drill deeper.
3. Be evidence-led — every claim must cite a log line, metric value, or CW datapoint.
4. If your evidence points at a dependency, list it under suspected_dependencies.

# Output format — REQUIRED
Return ONLY a JSON object matching this schema:
{
  "component": "${component.name}",
  "status": "healthy" | "degraded" | "failed" | "inconclusive",
  "confidence": 0.0-1.0,
  "findings": [
    { "summary": "...", "evidence": [{ "type": "log|metric|cw", "ref": "...", "value": "..." }], "severity": "info|warn|error|critical" }
  ],
  "suspected_dependencies": ["..."],
  "notes": "free-form text, ≤ 200 words"
}
`;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infra/prompt-generator.ts apps/api/test/prompt-generator.test.ts
git commit -m "feat(api): subagent prompt-file renderer"
```

### Task 2.4: InfraLoader service + on-disk emit

Reads `INFRA_MD_PATH`, validates, writes `infra/prompts/<name>.md` files, holds the parsed result in memory for other services.

**Files:**
- Create: `apps/api/src/infra/infra-loader.service.ts`
- Create: `apps/api/src/infra/infra.module.ts`
- Test: `apps/api/test/infra-loader.test.ts`

- [ ] **Step 1: Add NestJS deps**

Run: `pnpm --filter @rca/api add @nestjs/common@10.4.7 @nestjs/core@10.4.7 @nestjs/config@3.3.0 @nestjs/platform-express@10.4.7 reflect-metadata@0.2.2 rxjs@7.8.1`
Expected: installed.

- [ ] **Step 2: Write failing test**

File `apps/api/test/infra-loader.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
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
    const loader = new InfraLoaderService({
      infraMdPath: mdPath,
      promptsDir,
      maxComponents: 20,
    });
    loader.load();

    const files = readdirSync(promptsDir);
    expect(files).toContain('auth-service.md');
    const md = readFileSync(join(promptsDir, 'auth-service.md'), 'utf8');
    expect(md).toContain('name: auth-service-investigator');
    expect(loader.getComponents()).toHaveLength(1);
    expect(loader.getProse()).toContain('Request flow');
  });

  it('throws when file is missing', () => {
    const loader = new InfraLoaderService({
      infraMdPath: '/no/such/file.md',
      promptsDir: tmp(),
      maxComponents: 20,
    });
    expect(() => loader.load()).toThrow();
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 4: Write `apps/api/src/infra/infra-loader.service.ts`**

Content:
```ts
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

  getProse(): string {
    return this.prose;
  }
  getComponents(): Component[] {
    return this.components;
  }
  getWarnings(): string[] {
    return this.warnings;
  }
  getComponent(name: string): Component | undefined {
    return this.components.find((c) => c.name === name);
  }
  getDependencyGraph(): Record<string, string[]> {
    return Object.fromEntries(this.components.map((c) => [c.name, c.depends_on ?? []]));
  }
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Write `apps/api/src/infra/infra.module.ts`**

Content:
```ts
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
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/infra/infra-loader.service.ts apps/api/src/infra/infra.module.ts apps/api/test/infra-loader.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): InfraLoaderService loads + emits prompt files"
```

### Task 2.5: validate-infra CLI (standalone, no NestJS container)

Per spec §2.5 final line + §6.10.

**Files:**
- Create: `apps/api/src/cli/validate-infra.command.ts`

- [ ] **Step 1: Add CLI deps**

Run: `pnpm --filter @rca/api add nest-commander@3.15.0`
Expected: installed.

- [ ] **Step 2: Write `apps/api/src/cli/validate-infra.command.ts`**

Content:
```ts
import { readFileSync } from 'node:fs';
import { validateInfra } from '../infra/infra-parser';

export function runValidateInfra(path: string, maxComponents: number = 20): number {
  try {
    const md = readFileSync(path, 'utf8');
    const r = validateInfra(md, { maxComponents });
    console.log(`OK: ${r.components.length} components`);
    for (const w of r.warnings) console.warn(`WARN: ${w}`);
    return 0;
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    return 1;
  }
}

if (process.argv[2]) {
  process.exit(runValidateInfra(process.argv[2], Number(process.env.MAX_COMPONENTS ?? 20)));
}
```

- [ ] **Step 3: Verify against fixture**

Run: `pnpm --filter @rca/api exec tsx src/cli/validate-infra.command.ts test/fixtures/infra/two-components.md`
Expected: prints `OK: 2 components`, exits 0.

Run: `pnpm --filter @rca/api exec tsx src/cli/validate-infra.command.ts test/fixtures/infra/dangling-dep.md`
Expected: prints `FAIL: ...`, exits 1.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/cli/validate-infra.command.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): validate-infra CLI for standalone parser checks"
```

---

## Phase 3 — NestJS bootstrap, config, logger, healthz

The shell of the API: app module, ConfigService that parses env via the Zod schema, pino logger, and stub health endpoints (filled in by later phases).

### Task 3.1: ConfigService

**Files:**
- Create: `apps/api/src/config/config.service.ts`
- Create: `apps/api/src/config/config.module.ts`
- Test: `apps/api/test/config.service.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/config.service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ConfigService } from '../src/config/config.service';

describe('ConfigService', () => {
  const minimal = {
    GRAFANA_URL: 'https://g',
    GRAFANA_SERVICE_ACCOUNT_TOKEN: 't',
    MONGO_URI: 'mongodb://x',
  };

  it('parses a minimal env successfully', () => {
    const c = new ConfigService(minimal);
    expect(c.env.WINDOW_INITIAL_HOURS).toBe(4);
  });

  it('throws on missing required env var', () => {
    expect(() => new ConfigService({})).toThrow(/GRAFANA_URL/);
  });

  it('exposes typed accessor', () => {
    const c = new ConfigService(minimal);
    expect(c.env.GRAFANA_URL).toBe('https://g');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/config/config.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import { EnvSchema, type Env } from '@rca/agent';

@Injectable()
export class ConfigService {
  readonly env: Env;

  constructor(rawEnv: NodeJS.ProcessEnv | Record<string, unknown> = process.env) {
    const result = EnvSchema.safeParse(rawEnv);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid env config:\n${issues}`);
    }
    this.env = result.data;
  }
}
```

- [ ] **Step 4: Write `apps/api/src/config/config.module.ts`**

Content:
```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/ apps/api/test/config.service.test.ts
git commit -m "feat(api): ConfigService backed by zod env schema"
```

### Task 3.2: Pino logger

**Files:**
- Create: `apps/api/src/logger/pino-logger.ts`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @rca/api add nestjs-pino@4.1.0 pino@9.5.0 pino-http@10.3.0`
Expected: installed.

- [ ] **Step 2: Write `apps/api/src/logger/pino-logger.ts`**

Content:
```ts
import type { Params } from 'nestjs-pino';

export function pinoOptions(level: string): Params {
  return {
    pinoHttp: {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-grafana-token"]',
          '*.token',
          '*.secret',
          '*.password',
          '*.GRAFANA_SERVICE_ACCOUNT_TOKEN',
          '*.SLACK_WEBHOOK_URL',
        ],
        censor: '[REDACTED]',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/logger/pino-logger.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): pino logger config with header/secret redaction"
```

### Task 3.3: AppModule + main.ts bootstrap

**Files:**
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/app.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { pinoOptions } from './logger/pino-logger';
import { InfraModule } from './infra/infra.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => pinoOptions(c.env.LOG_LEVEL),
    }),
    InfraModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Replace `apps/api/src/main.ts`**

Content:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  await app.listen(config.env.PORT, '0.0.0.0');
  app.get(Logger).log(`rca-api listening on :${config.env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Commit (after health module exists — see next task)**

(commit at end of Task 3.4)

### Task 3.4: Health module — `/healthz` + `/readyz`

Implements spec §5.8.

**Files:**
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Test: `apps/api/test/health.controller.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/health.controller.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { HealthController } from '../src/health/health.controller';

describe('HealthController', () => {
  it('reports infra loaded + dependencies stub OK before mongo/grafana wired in', async () => {
    const ctrl = new HealthController(
      { ping: async () => true } as any,
      { ping: async () => true } as any,
      { checkAuth: async () => true } as any,
      { getCounts: () => ({ critical: 0, error: 0, warn: 1 }) } as any,
      { getComponents: () => [{ name: 'x' }] } as any,
    );
    const r = await ctrl.healthz();
    expect(r.status).toBe('ok');
    expect(r.unacknowledged_events).toEqual({ critical: 0, error: 0, warn: 1 });
  });

  it('reports degraded status when any dependency is down', async () => {
    const ctrl = new HealthController(
      { ping: async () => false } as any,
      { ping: async () => true } as any,
      { checkAuth: async () => true } as any,
      { getCounts: () => ({ critical: 0, error: 0, warn: 0 }) } as any,
      { getComponents: () => [{ name: 'x' }] } as any,
    );
    const r = await ctrl.healthz();
    expect(r.status).toBe('degraded');
    expect(r.grafana).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/health/health.controller.ts`**

Content:
```ts
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

export interface PingService {
  ping(): Promise<boolean>;
}

export interface ClaudeAuthService {
  checkAuth(): Promise<boolean>;
}

export interface EventsCountService {
  getCounts(): { critical: number; error: number; warn: number };
}

export interface InfraStateService {
  getComponents(): { name: string }[];
}

@Controller()
export class HealthController {
  constructor(
    private readonly grafana: PingService,
    private readonly mongo: PingService,
    private readonly claudeAuth: ClaudeAuthService,
    private readonly events: EventsCountService,
    private readonly infra: InfraStateService,
  ) {}

  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  async healthz() {
    const [grafana, mongo, claudeAuth] = await Promise.all([
      this.grafana.ping().catch(() => false),
      this.mongo.ping().catch(() => false),
      this.claudeAuth.checkAuth().catch(() => false),
    ]);
    const ok = grafana && mongo && claudeAuth;
    return {
      status: ok ? 'ok' : 'degraded',
      grafana,
      mongo,
      claude_auth: claudeAuth,
      unacknowledged_events: this.events.getCounts(),
    };
  }

  @Get('readyz')
  async readyz() {
    const components = this.infra.getComponents();
    const [mongo, claudeAuth] = await Promise.all([
      this.mongo.ping().catch(() => false),
      this.claudeAuth.checkAuth().catch(() => false),
    ]);
    if (components.length === 0 || !mongo || !claudeAuth) {
      return { status: 'not_ready', infra_loaded: components.length > 0, mongo, claude_auth: claudeAuth };
    }
    return { status: 'ready' };
  }
}
```

- [ ] **Step 4: Write `apps/api/src/health/health.module.ts`**

Stub providers — replaced by real services in later phases.

Content:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { InfraModule } from '../infra/infra.module';

const stubPing = { ping: async () => true };
const stubAuth = { checkAuth: async () => true };
const stubEvents = { getCounts: () => ({ critical: 0, error: 0, warn: 0 }) };

@Module({
  imports: [InfraModule],
  controllers: [HealthController],
  providers: [
    { provide: 'GRAFANA_PING', useValue: stubPing },
    { provide: 'MONGO_PING', useValue: stubPing },
    { provide: 'CLAUDE_AUTH', useValue: stubAuth },
    { provide: 'EVENTS_COUNTS', useValue: stubEvents },
    {
      provide: HealthController,
      inject: ['GRAFANA_PING', 'MONGO_PING', 'CLAUDE_AUTH', 'EVENTS_COUNTS', InfraLoaderService],
      useFactory: (g: any, m: any, a: any, e: any, infra: InfraLoaderService) =>
        new HealthController(g, m, a, e, infra),
    },
  ],
})
export class HealthModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/main.ts apps/api/src/health/ apps/api/test/health.controller.test.ts
git commit -m "feat(api): NestJS bootstrap + healthz/readyz with stub deps"
```

---

## Phase 4 — OutboundCallGuard + circuit breaker

Implements spec §5.1, §5.2. Every external HTTP call goes through this. The breaker is per `(target, operation)` key.

### Task 4.1: Circuit breaker primitive

**Files:**
- Create: `apps/api/src/guard/circuit-breaker.ts`
- Test: `apps/api/test/circuit-breaker.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/circuit-breaker.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../src/guard/circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts CLOSED and stays CLOSED on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
    cb.recordSuccess();
    expect(cb.state()).toBe('CLOSED');
    expect(cb.canPass()).toBe(true);
  });

  it('opens after threshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, openMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    expect(cb.canPass()).toBe(false);
  });

  it('half-opens after openMs elapses', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    vi.advanceTimersByTime(101);
    expect(cb.canPass()).toBe(true);
    expect(cb.state()).toBe('HALF_OPEN');
    vi.useRealTimers();
  });

  it('a success in HALF_OPEN closes the circuit', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(101);
    cb.canPass();
    cb.recordSuccess();
    expect(cb.state()).toBe('CLOSED');
    vi.useRealTimers();
  });

  it('a failure in HALF_OPEN re-opens the circuit', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 1, openMs: 100 });
    cb.recordFailure();
    vi.advanceTimersByTime(101);
    cb.canPass();
    cb.recordFailure();
    expect(cb.state()).toBe('OPEN');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/guard/circuit-breaker.ts`**

Content:
```ts
export type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  state(): CbState {
    if (this.openedAt === null) return 'CLOSED';
    if (Date.now() - this.openedAt >= this.opts.openMs) return 'HALF_OPEN';
    return 'OPEN';
  }

  canPass(): boolean {
    return this.state() !== 'OPEN';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    const s = this.state();
    if (s === 'HALF_OPEN') {
      this.openedAt = Date.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) {
      this.openedAt = Date.now();
    }
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/guard/circuit-breaker.ts apps/api/test/circuit-breaker.test.ts
git commit -m "feat(api): per-target circuit breaker primitive"
```

### Task 4.2: OutboundCallGuard service

Wraps every external call. Records events via an `EventsSink` (just an interface for now; Phase 6 supplies the real impl).

**Files:**
- Create: `apps/api/src/guard/outbound-call-guard.ts`
- Test: `apps/api/test/outbound-call-guard.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/outbound-call-guard.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

const noopSink = { recordFailure: vi.fn().mockResolvedValue(undefined), recordSuccess: vi.fn().mockResolvedValue(undefined) };

describe('OutboundCallGuard.withGuard', () => {
  it('returns the inner result on first-try success', async () => {
    const g = new OutboundCallGuard(noopSink);
    const r = await g.withGuard({ target: 'grafana', operation: 'query_loki' }, async () => 42);
    expect(r).toBe(42);
  });

  it('retries on retriable failure', async () => {
    const g = new OutboundCallGuard(noopSink);
    let attempts = 0;
    const r = await g.withGuard(
      { target: 'grafana', operation: 'query_loki', retries: 2, baseDelayMs: 1 },
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('boom');
        return 'ok';
      },
    );
    expect(r).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('records a failure event when retries are exhausted', async () => {
    const sink = { recordFailure: vi.fn().mockResolvedValue(undefined), recordSuccess: vi.fn().mockResolvedValue(undefined) };
    const g = new OutboundCallGuard(sink);
    await expect(
      g.withGuard({ target: 'grafana', operation: 'query_loki', retries: 1, baseDelayMs: 1 }, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(sink.recordFailure).toHaveBeenCalled();
  });

  it('refuses to call when breaker is open', async () => {
    const g = new OutboundCallGuard(noopSink);
    // force-open
    for (let i = 0; i < 5; i++) {
      await g.withGuard({ target: 'grafana', operation: 'op-open', retries: 0, baseDelayMs: 0 }, async () => {
        throw new Error('boom');
      }).catch(() => {});
    }
    await expect(
      g.withGuard({ target: 'grafana', operation: 'op-open' }, async () => 'ok'),
    ).rejects.toThrow(/circuit open/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/guard/outbound-call-guard.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';

export type GuardTarget = 'grafana' | 'anthropic' | 'mongo' | 'slack' | 'claude_auth';

export interface GuardCallParams {
  target: GuardTarget;
  operation: string;
  retries?: number;
  baseDelayMs?: number;
  runId?: string;
  component?: string;
}

export interface EventsSink {
  recordFailure(input: {
    target: GuardTarget;
    operation: string;
    error: Error;
    attempts: number;
    runId?: string;
    component?: string;
  }): Promise<void>;
  recordSuccess(input: { target: GuardTarget; operation: string }): Promise<void>;
}

@Injectable()
export class OutboundCallGuard {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly events: EventsSink) {}

  private breaker(key: string): CircuitBreaker {
    let cb = this.breakers.get(key);
    if (!cb) {
      cb = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
      this.breakers.set(key, cb);
    }
    return cb;
  }

  breakerState(target: GuardTarget, operation: string) {
    return this.breaker(`${target}:${operation}`).state();
  }

  async withGuard<T>(params: GuardCallParams, fn: () => Promise<T>): Promise<T> {
    const key = `${params.target}:${params.operation}`;
    const breaker = this.breaker(key);
    if (!breaker.canPass()) {
      throw new Error(`Circuit open for ${key}`);
    }

    const retries = params.retries ?? 2;
    const baseDelayMs = params.baseDelayMs ?? 250;
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const out = await fn();
        breaker.recordSuccess();
        await this.events.recordSuccess({ target: params.target, operation: params.operation });
        return out;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(4, attempt)));
        }
      }
    }
    breaker.recordFailure();
    await this.events.recordFailure({
      target: params.target,
      operation: params.operation,
      error: lastErr!,
      attempts: retries + 1,
      runId: params.runId,
      component: params.component,
    });
    throw lastErr!;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/guard/outbound-call-guard.ts apps/api/test/outbound-call-guard.test.ts
git commit -m "feat(api): OutboundCallGuard with per-target circuit breaker"
```

---

## Phase 5 — Mongo connection + repositories

Implements spec §3.3 (`runs`), §3.5 (`rcas` past lookup), §5.9 (`events`), §5.4 (self-observability), plus `resolutions` and `alerts`.

### Task 5.1: Mongo service + connection

**Files:**
- Create: `apps/api/src/mongo/mongo.service.ts`
- Create: `apps/api/src/mongo/mongo.module.ts`
- Test: `apps/api/test/mongo.service.test.ts`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @rca/api add mongodb@6.10.0 && pnpm --filter @rca/api add -D mongodb-memory-server@10.1.2`
Expected: installed.

- [ ] **Step 2: Write failing test**

File `apps/api/test/mongo.service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoService } from '../src/mongo/mongo.service';

let mongod: MongoMemoryServer;
let svc: MongoService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  svc = new MongoService(mongod.getUri());
  await svc.connect();
});

afterAll(async () => {
  await svc.close();
  await mongod.stop();
});

describe('MongoService', () => {
  it('ping returns true after connect', async () => {
    expect(await svc.ping()).toBe(true);
  });

  it('db() returns a Db with the rca database', () => {
    expect(svc.db().databaseName).toBe('rca');
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 4: Write `apps/api/src/mongo/mongo.service.ts`**

Content:
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, type Db } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleDestroy {
  private client: MongoClient;
  private readonly dbName: string;

  constructor(uri: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    const parsed = new URL(uri.replace(/^mongodb\+srv:/, 'mongodb:'));
    const path = parsed.pathname.replace('/', '');
    this.dbName = path || 'rca';
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.db('admin').command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  db(): Db {
    return this.client.db(this.dbName);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
```

- [ ] **Step 5: Write `apps/api/src/mongo/mongo.module.ts`**

Content:
```ts
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
```

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/mongo/mongo.service.ts apps/api/src/mongo/mongo.module.ts apps/api/test/mongo.service.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): Mongo connection service"
```

### Task 5.2: Runs repository

**Files:**
- Create: `apps/api/src/mongo/runs.repo.ts`
- Test: append to `apps/api/test/mongo.service.test.ts`

- [ ] **Step 1: Append failing test**

Append:
```ts
import { RunsRepo } from '../src/mongo/runs.repo';

describe('RunsRepo', () => {
  it('creates a new run document and increments iteration', async () => {
    const repo = new RunsRepo(svc.db());
    const id = await repo.create({
      trigger: 'manual',
      window: { from: '2026-05-22T00:00:00Z', to: '2026-05-22T04:00:00Z' },
    });
    const run = await repo.findById(id);
    expect(run?.status).toBe('running');
    expect(run?.iteration).toBe(0);

    await repo.bumpIteration(id, { from: '2026-05-21T22:00:00Z', to: '2026-05-22T04:00:00Z' });
    const r2 = await repo.findById(id);
    expect(r2?.iteration).toBe(1);
    expect(r2?.current_window?.from).toBe('2026-05-21T22:00:00Z');
  });

  it('finalize sets status and end_time', async () => {
    const repo = new RunsRepo(svc.db());
    const id = await repo.create({
      trigger: 'manual',
      window: { from: 'a', to: 'b' },
    });
    await repo.finalize(id, 'completed', 'success');
    const run = await repo.findById(id);
    expect(run?.status).toBe('completed');
    expect(run?.stop_reason).toBe('success');
    expect(run?.ended_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/mongo/runs.repo.ts`**

Content:
```ts
import { ObjectId, type Db, type Collection } from 'mongodb';

export type Trigger = 'manual' | 'webhook' | 'health';
export type RunStatus = 'running' | 'completed' | 'degraded' | 'failed';

export interface RunDoc {
  _id: ObjectId;
  started_at: Date;
  ended_at?: Date;
  trigger: Trigger;
  window: { from: string; to: string };
  current_window?: { from: string; to: string };
  iteration: number;
  status: RunStatus;
  stop_reason?: string;
  alert_uid?: string;
  alert_query?: string;
  rca_id?: ObjectId;
  tokens?: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
}

export class RunsRepo {
  private col: Collection<RunDoc>;
  constructor(db: Db) {
    this.col = db.collection<RunDoc>('runs');
  }

  async create(input: {
    trigger: Trigger;
    window: { from: string; to: string };
    alert_uid?: string;
    alert_query?: string;
  }): Promise<string> {
    const doc: RunDoc = {
      _id: new ObjectId(),
      started_at: new Date(),
      trigger: input.trigger,
      window: input.window,
      current_window: input.window,
      iteration: 0,
      status: 'running',
      alert_uid: input.alert_uid,
      alert_query: input.alert_query,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findById(id: string): Promise<RunDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async bumpIteration(id: string, window: { from: string; to: string }): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { iteration: 1 }, $set: { current_window: window } },
    );
  }

  async finalize(id: string, status: RunStatus, stop_reason: string, rcaId?: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          stop_reason,
          ended_at: new Date(),
          ...(rcaId ? { rca_id: new ObjectId(rcaId) } : {}),
        },
      },
    );
  }

  async recordTokens(id: string, tokens: NonNullable<RunDoc['tokens']>): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { tokens } });
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mongo/runs.repo.ts apps/api/test/mongo.service.test.ts
git commit -m "feat(api): RunsRepo with iteration + finalize"
```

### Task 5.3: RCAs repository

**Files:**
- Create: `apps/api/src/mongo/rcas.repo.ts`
- Test: append to `apps/api/test/mongo.service.test.ts`

- [ ] **Step 1: Append failing test**

Append:
```ts
import { RcasRepo } from '../src/mongo/rcas.repo';

describe('RcasRepo', () => {
  it('persists and reads back an RCA, status defaults to "open"', async () => {
    const repo = new RcasRepo(svc.db());
    const id = await repo.create({
      runId: new ObjectId().toHexString(),
      window: { from: 'a', to: 'b' },
      rca: {
        summary: 's',
        root_cause: { component: 'postgres-primary', description: 'd', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: [],
        similar_past_rcas: [],
      },
    });
    const out = await repo.findById(id);
    expect(out?.status).toBe('open');
    expect(out?.rca.root_cause.component).toBe('postgres-primary');
  });

  it('findRecentByComponent returns up to 3 resolved RCAs', async () => {
    const repo = new RcasRepo(svc.db());
    for (let i = 0; i < 5; i++) {
      const id = await repo.create({
        runId: new ObjectId().toHexString(),
        window: { from: 'a', to: 'b' },
        rca: {
          summary: `r${i}`,
          root_cause: { component: 'x-service', description: '', confidence: 0.8 },
          contributing_factors: [],
          timeline: [],
          evidence: [],
          suggested_next_steps: [],
          similar_past_rcas: [],
        },
      });
      if (i < 4) await repo.markResolved(id, 'note');
    }
    const recent = await repo.findRecentResolvedByComponent('x-service', 3);
    expect(recent).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/mongo/rcas.repo.ts`**

Content:
```ts
import { ObjectId, type Db, type Collection } from 'mongodb';
import type { RcaOutput } from '@rca/agent';

export type RcaStatus = 'open' | 'resolved' | 'ignored';

export interface RcaDoc {
  _id: ObjectId;
  run_id: ObjectId;
  created_at: Date;
  window: { from: string; to: string };
  rca: RcaOutput;
  status: RcaStatus;
  resolution_note?: string;
  resolution_steps?: string[];
  resolved_at?: Date;
}

export class RcasRepo {
  private col: Collection<RcaDoc>;
  constructor(db: Db) {
    this.col = db.collection<RcaDoc>('rcas');
  }

  async create(input: {
    runId: string;
    window: { from: string; to: string };
    rca: RcaOutput;
  }): Promise<string> {
    const doc: RcaDoc = {
      _id: new ObjectId(),
      run_id: new ObjectId(input.runId),
      created_at: new Date(),
      window: input.window,
      rca: input.rca,
      status: 'open',
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findById(id: string): Promise<RcaDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async findRecentResolvedByComponent(component: string, limit: number): Promise<RcaDoc[]> {
    return this.col
      .find({ 'rca.root_cause.component': component, status: 'resolved' })
      .sort({ resolved_at: -1 })
      .limit(limit)
      .toArray();
  }

  async list(limit = 50): Promise<RcaDoc[]> {
    return this.col.find({}).sort({ created_at: -1 }).limit(limit).toArray();
  }

  async markResolved(id: string, note: string, steps: string[] = []): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'resolved', resolution_note: note, resolution_steps: steps, resolved_at: new Date() } },
    );
  }

  async markIgnored(id: string): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'ignored' } });
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mongo/rcas.repo.ts apps/api/test/mongo.service.test.ts
git commit -m "feat(api): RcasRepo with past-resolved lookup"
```

### Task 5.4: Events repository

Implements spec §5.9 data shape.

**Files:**
- Create: `apps/api/src/mongo/events.repo.ts`
- Test: append to `apps/api/test/mongo.service.test.ts`

- [ ] **Step 1: Append failing test**

Append:
```ts
import { EventsRepo } from '../src/mongo/events.repo';

describe('EventsRepo', () => {
  it('inserts an event and auto-resolves prior unack events for same source+op', async () => {
    const repo = new EventsRepo(svc.db());
    await repo.insert({
      severity: 'critical',
      source: 'slack',
      operation: 'post_message',
      message: 'fail 1',
    });
    await repo.insert({
      severity: 'critical',
      source: 'slack',
      operation: 'post_message',
      message: 'fail 2',
    });
    const open = await repo.listUnacknowledged();
    expect(open.length).toBe(2);

    await repo.autoResolve('slack', 'post_message');
    const after = await repo.listUnacknowledged();
    expect(after.length).toBe(0);
  });

  it('counts by severity', async () => {
    const repo = new EventsRepo(svc.db());
    await repo.insert({ severity: 'warn', source: 'grafana', operation: 'op-a', message: 'x' });
    const counts = await repo.countsBySeverity();
    expect(counts.warn).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/mongo/events.repo.ts`**

Content:
```ts
import { ObjectId, type Db, type Collection } from 'mongodb';

export type Severity = 'info' | 'warn' | 'error' | 'critical';
export type EventSource =
  | 'grafana'
  | 'mongo'
  | 'slack'
  | 'anthropic'
  | 'claude_auth'
  | 'webhook'
  | 'infra_md'
  | 'circuit_breaker'
  | 'stop_hook';

export type EventStatus = 'unacknowledged' | 'ignored' | 'resolved';

export interface EventDoc {
  _id: ObjectId;
  created_at: Date;
  severity: Severity;
  source: EventSource;
  operation: string;
  message: string;
  context?: Record<string, unknown>;
  status: EventStatus;
  acknowledged_by?: string | null;
  acknowledged_at?: Date | null;
  resolved_at?: Date | null;
  suggested_fix?: string | null;
}

export class EventsRepo {
  private col: Collection<EventDoc>;
  constructor(db: Db) {
    this.col = db.collection<EventDoc>('events');
  }

  async insert(input: {
    severity: Severity;
    source: EventSource;
    operation: string;
    message: string;
    context?: Record<string, unknown>;
    suggested_fix?: string;
  }): Promise<string> {
    const doc: EventDoc = {
      _id: new ObjectId(),
      created_at: new Date(),
      severity: input.severity,
      source: input.source,
      operation: input.operation,
      message: input.message,
      context: input.context,
      status: 'unacknowledged',
      acknowledged_by: null,
      acknowledged_at: null,
      resolved_at: null,
      suggested_fix: input.suggested_fix ?? null,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async autoResolve(source: EventSource, operation: string): Promise<number> {
    const r = await this.col.updateMany(
      { source, operation, status: 'unacknowledged' },
      { $set: { status: 'resolved', resolved_at: new Date() } },
    );
    return r.modifiedCount;
  }

  async listUnacknowledged(): Promise<EventDoc[]> {
    return this.col.find({ status: 'unacknowledged' }).sort({ created_at: -1 }).toArray();
  }

  async list(filter: { severity?: Severity; source?: EventSource; status?: EventStatus } = {}): Promise<EventDoc[]> {
    return this.col.find(filter).sort({ created_at: -1 }).limit(200).toArray();
  }

  async findById(id: string): Promise<EventDoc | null> {
    return this.col.findOne({ _id: new ObjectId(id) });
  }

  async acknowledge(id: string, by: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { acknowledged_by: by, acknowledged_at: new Date() } },
    );
  }

  async ignore(id: string): Promise<void> {
    await this.col.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'ignored' } });
  }

  async resolve(id: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'resolved', resolved_at: new Date() } },
    );
  }

  async countsBySeverity(): Promise<Record<Severity, number>> {
    const out: Record<Severity, number> = { info: 0, warn: 0, error: 0, critical: 0 };
    const rows = await this.col
      .aggregate([
        { $match: { status: 'unacknowledged' } },
        { $group: { _id: '$severity', n: { $sum: 1 } } },
      ])
      .toArray();
    for (const r of rows) out[r._id as Severity] = r.n;
    return out;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/mongo/events.repo.ts apps/api/test/mongo.service.test.ts
git commit -m "feat(api): EventsRepo with auto-resolve + severity counts"
```

### Task 5.5: Resolutions + Alerts repositories

Minimal companion stores. Resolutions are the post-hoc notes; alerts cache the webhook payload metadata for the run.

**Files:**
- Create: `apps/api/src/mongo/resolutions.repo.ts`
- Create: `apps/api/src/mongo/alerts.repo.ts`

- [ ] **Step 1: Write `apps/api/src/mongo/resolutions.repo.ts`**

Content:
```ts
import { ObjectId, type Db, type Collection } from 'mongodb';

export interface ResolutionDoc {
  _id: ObjectId;
  rca_id: ObjectId;
  created_at: Date;
  note: string;
  steps: string[];
}

export class ResolutionsRepo {
  private col: Collection<ResolutionDoc>;
  constructor(db: Db) {
    this.col = db.collection<ResolutionDoc>('resolutions');
  }

  async create(rcaId: string, note: string, steps: string[]): Promise<string> {
    const doc: ResolutionDoc = {
      _id: new ObjectId(),
      rca_id: new ObjectId(rcaId),
      created_at: new Date(),
      note,
      steps,
    };
    await this.col.insertOne(doc);
    return doc._id.toHexString();
  }

  async findByRcaId(rcaId: string): Promise<ResolutionDoc | null> {
    return this.col.findOne({ rca_id: new ObjectId(rcaId) });
  }
}
```

- [ ] **Step 2: Write `apps/api/src/mongo/alerts.repo.ts`**

Content:
```ts
import { ObjectId, type Db, type Collection } from 'mongodb';

export interface AlertDoc {
  _id: ObjectId;
  alert_uid: string;
  first_seen_at: Date;
  payload: Record<string, unknown>;
  query: string;
}

export class AlertsRepo {
  private col: Collection<AlertDoc>;
  constructor(db: Db) {
    this.col = db.collection<AlertDoc>('alerts');
  }

  async cache(alertUid: string, payload: Record<string, unknown>, query: string): Promise<void> {
    await this.col.updateOne(
      { alert_uid: alertUid },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          alert_uid: alertUid,
          first_seen_at: new Date(),
        },
        $set: { payload, query },
      },
      { upsert: true },
    );
  }

  async getQuery(alertUid: string): Promise<string | null> {
    const r = await this.col.findOne({ alert_uid: alertUid });
    return r?.query ?? null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/mongo/resolutions.repo.ts apps/api/src/mongo/alerts.repo.ts
git commit -m "feat(api): ResolutionsRepo + AlertsRepo"
```

---

## Phase 6 — Events service, auto-resolve, controller

Connects `EventsRepo` to `OutboundCallGuard` (via the `EventsSink` interface from Phase 4) and exposes an HTTP controller for the dashboard.

### Task 6.1: EventsService implements EventsSink + auto-resolve

**Files:**
- Create: `apps/api/src/events/events.service.ts`
- Test: `apps/api/test/events.service.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/events.service.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { EventsRepo } from '../src/mongo/events.repo';
import { EventsService } from '../src/events/events.service';

let mongod: MongoMemoryServer;
let client: MongoClient;
let repo: EventsRepo;
let svc: EventsService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});

beforeEach(async () => {
  await client.db('rca').collection('events').deleteMany({});
  repo = new EventsRepo(client.db('rca'));
  svc = new EventsService(repo);
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('EventsService', () => {
  it('records failure as severity=critical for known-critical sources', async () => {
    await svc.recordFailure({
      target: 'grafana',
      operation: 'query_loki',
      error: new Error('500'),
      attempts: 3,
    });
    const open = await repo.listUnacknowledged();
    expect(open[0].severity).toBe('critical');
    expect(open[0].source).toBe('grafana');
  });

  it('records failure as severity=error for slack', async () => {
    await svc.recordFailure({
      target: 'slack',
      operation: 'post_message',
      error: new Error('400'),
      attempts: 1,
    });
    const open = await repo.listUnacknowledged();
    expect(open[0].severity).toBe('error');
  });

  it('on success auto-resolves any unack events for the same source+op', async () => {
    await svc.recordFailure({
      target: 'slack',
      operation: 'post_message',
      error: new Error('fail'),
      attempts: 1,
    });
    expect((await repo.listUnacknowledged()).length).toBe(1);
    await svc.recordSuccess({ target: 'slack', operation: 'post_message' });
    expect((await repo.listUnacknowledged()).length).toBe(0);
  });

  it('respects LOG_SUCCESSES=true by creating an info event', async () => {
    const noisy = new EventsService(repo, { logSuccesses: true });
    await noisy.recordSuccess({ target: 'grafana', operation: 'query_loki' });
    const list = await repo.list({ severity: 'info' });
    expect(list.length).toBe(1);
  });

  it('getCounts returns aggregated unack counts', async () => {
    await svc.recordFailure({ target: 'grafana', operation: 'op-a', error: new Error('x'), attempts: 1 });
    const c = await svc.getCounts();
    expect(c.critical).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/events/events.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import { EventsRepo, type EventSource, type Severity } from '../mongo/events.repo';
import type { EventsSink, GuardTarget } from '../guard/outbound-call-guard';

export interface EventsServiceOptions {
  logSuccesses?: boolean;
}

const TARGET_TO_SOURCE: Record<GuardTarget, EventSource> = {
  grafana: 'grafana',
  anthropic: 'anthropic',
  mongo: 'mongo',
  slack: 'slack',
  claude_auth: 'claude_auth',
};

const SEVERITY_BY_TARGET: Record<GuardTarget, Severity> = {
  grafana: 'critical',
  anthropic: 'critical',
  mongo: 'critical',
  slack: 'error',
  claude_auth: 'critical',
};

const SUGGESTED_FIX: Partial<Record<GuardTarget, string>> = {
  grafana: 'Check GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN validity.',
  slack: 'Verify SLACK_WEBHOOK_URL.',
  anthropic: 'Check Anthropic status + Claude CLI auth (run `claude login`).',
  claude_auth: 'Run `claude login` on host then restart rca-api.',
  mongo: 'Check MONGO_URI and that the database is reachable.',
};

@Injectable()
export class EventsService implements EventsSink {
  constructor(
    private readonly repo: EventsRepo,
    private readonly opts: EventsServiceOptions = {},
  ) {}

  async recordFailure(input: {
    target: GuardTarget;
    operation: string;
    error: Error;
    attempts: number;
    runId?: string;
    component?: string;
  }): Promise<void> {
    await this.repo.insert({
      severity: SEVERITY_BY_TARGET[input.target],
      source: TARGET_TO_SOURCE[input.target],
      operation: input.operation,
      message: `${input.target}.${input.operation} failed after ${input.attempts} attempt(s): ${input.error.message}`,
      context: { run_id: input.runId, component: input.component, attempts: input.attempts },
      suggested_fix: SUGGESTED_FIX[input.target],
    });
  }

  async recordSuccess(input: { target: GuardTarget; operation: string }): Promise<void> {
    const source = TARGET_TO_SOURCE[input.target];
    await this.repo.autoResolve(source, input.operation);
    if (this.opts.logSuccesses) {
      await this.repo.insert({
        severity: 'info',
        source,
        operation: input.operation,
        message: `${input.target}.${input.operation} succeeded`,
      });
    }
  }

  async recordCircuitBreakerOpen(target: GuardTarget, operation: string): Promise<void> {
    await this.repo.insert({
      severity: 'critical',
      source: 'circuit_breaker',
      operation: `${target}:${operation}`,
      message: `Circuit opened for ${target}.${operation} after 5 consecutive failures`,
    });
  }

  async getCounts(): Promise<{ critical: number; error: number; warn: number }> {
    const c = await this.repo.countsBySeverity();
    return { critical: c.critical, error: c.error, warn: c.warn };
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/events/events.service.ts apps/api/test/events.service.test.ts
git commit -m "feat(api): EventsService implements OutboundCallGuard sink + auto-resolve"
```

### Task 6.2: EventsController

**Files:**
- Create: `apps/api/src/events/events.controller.ts`
- Create: `apps/api/src/events/events.module.ts`

- [ ] **Step 1: Write `apps/api/src/events/events.controller.ts`**

Content:
```ts
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { EventsRepo, type EventSource, type Severity, type EventStatus } from '../mongo/events.repo';

@Controller('api/events')
export class EventsController {
  constructor(private readonly repo: EventsRepo) {}

  @Get()
  list(
    @Query('severity') severity?: Severity,
    @Query('source') source?: EventSource,
    @Query('status') status?: EventStatus,
  ) {
    return this.repo.list({ severity, source, status });
  }

  @Get('unacknowledged')
  unack() {
    return this.repo.listUnacknowledged();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.repo.findById(id);
  }

  @Patch(':id/ignore')
  async ignore(@Param('id') id: string) {
    await this.repo.ignore(id);
    return { ok: true };
  }

  @Patch(':id/resolve')
  async resolve(@Param('id') id: string) {
    await this.repo.resolve(id);
    return { ok: true };
  }

  @Patch(':id/acknowledge')
  async ack(@Param('id') id: string, @Body() body: { by?: string }) {
    await this.repo.acknowledge(id, body.by ?? 'user');
    return { ok: true };
  }
}
```

- [ ] **Step 2: Write `apps/api/src/events/events.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { MongoService } from '../mongo/mongo.service';
import { EventsRepo } from '../mongo/events.repo';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { ConfigService } from '../config/config.service';

@Module({
  providers: [
    {
      provide: EventsRepo,
      inject: [MongoService],
      useFactory: (m: MongoService) => new EventsRepo(m.db()),
    },
    {
      provide: EventsService,
      inject: [EventsRepo, ConfigService],
      useFactory: (r: EventsRepo, c: ConfigService) =>
        new EventsService(r, { logSuccesses: c.env.LOG_SUCCESSES }),
    },
  ],
  controllers: [EventsController],
  exports: [EventsService, EventsRepo],
})
export class EventsModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/events/events.controller.ts apps/api/src/events/events.module.ts
git commit -m "feat(api): EventsController + module"
```

---

## Phase 7 — Grafana client

Implements spec §1.2, §3.2, §4.3. Three query methods (Loki, Prom, CloudWatch), auto-discovery of datasource UIDs, alert state poll. Every call goes through `OutboundCallGuard`.

### Task 7.1: Datasource auto-discovery

**Files:**
- Create: `apps/api/src/grafana/datasource-discovery.ts`
- Test: `apps/api/test/datasource-discovery.test.ts`

- [ ] **Step 1: Add nock**

Run: `pnpm --filter @rca/api add -D nock@13.5.6`
Expected: installed.

- [ ] **Step 2: Write failing test**

File `apps/api/test/datasource-discovery.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { discoverDatasources } from '../src/grafana/datasource-discovery';

afterEach(() => nock.cleanAll());

describe('discoverDatasources', () => {
  it('picks first match by type for loki, prometheus, cloudwatch', async () => {
    nock('https://g')
      .get('/api/datasources')
      .reply(200, [
        { uid: 'p1', type: 'prometheus', name: 'Prom A' },
        { uid: 'l1', type: 'loki', name: 'Loki' },
        { uid: 'c1', type: 'cloudwatch', name: 'CW' },
      ]);
    const r = await discoverDatasources({ baseUrl: 'https://g', token: 't' });
    expect(r).toEqual({ loki: 'l1', prom: 'p1', cw: 'c1' });
  });

  it('returns undefined for missing types', async () => {
    nock('https://g')
      .get('/api/datasources')
      .reply(200, [{ uid: 'l1', type: 'loki', name: 'Loki' }]);
    const r = await discoverDatasources({ baseUrl: 'https://g', token: 't' });
    expect(r.loki).toBe('l1');
    expect(r.prom).toBeUndefined();
    expect(r.cw).toBeUndefined();
  });

  it('passes bearer token in Authorization header', async () => {
    const scope = nock('https://g', {
      reqheaders: { authorization: 'Bearer tok' },
    })
      .get('/api/datasources')
      .reply(200, []);
    await discoverDatasources({ baseUrl: 'https://g', token: 'tok' });
    expect(scope.isDone()).toBe(true);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 4: Write `apps/api/src/grafana/datasource-discovery.ts`**

Content:
```ts
export interface DiscoveryInput {
  baseUrl: string;
  token: string;
}

export interface DiscoveredUids {
  loki?: string;
  prom?: string;
  cw?: string;
}

interface DsRow {
  uid: string;
  type: string;
  name: string;
}

export async function discoverDatasources(input: DiscoveryInput): Promise<DiscoveredUids> {
  const res = await fetch(`${input.baseUrl.replace(/\/$/, '')}/api/datasources`, {
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!res.ok) throw new Error(`Grafana datasource list returned ${res.status}`);
  const rows = (await res.json()) as DsRow[];

  const find = (t: string) => rows.find((r) => r.type === t)?.uid;
  return {
    loki: find('loki'),
    prom: find('prometheus'),
    cw: find('cloudwatch'),
  };
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/grafana/datasource-discovery.ts apps/api/test/datasource-discovery.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): grafana datasource auto-discovery"
```

### Task 7.2: Loki query method

**Files:**
- Create: `apps/api/src/grafana/grafana.service.ts`
- Create: `apps/api/test/fixtures/grafana/loki-error-window.json`
- Test: `apps/api/test/grafana.service.test.ts`

- [ ] **Step 1: Write fixture `apps/api/test/fixtures/grafana/loki-error-window.json`**

Content:
```json
{
  "status": "success",
  "data": {
    "resultType": "streams",
    "result": [
      {
        "stream": { "service": "auth-service", "level": "error" },
        "values": [
          ["1716364800000000000", "auth-service ERROR connection refused"],
          ["1716364860000000000", "auth-service ERROR timeout"]
        ]
      }
    ],
    "stats": {}
  }
}
```

- [ ] **Step 2: Write failing test**

File `apps/api/test/grafana.service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GrafanaService } from '../src/grafana/grafana.service';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

const sink = {
  recordFailure: async () => {},
  recordSuccess: async () => {},
};

const lokiFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/loki-error-window.json'), 'utf8'),
);

afterEach(() => nock.cleanAll());

describe('GrafanaService.queryLoki', () => {
  let svc: GrafanaService;
  beforeEach(() => {
    svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l-uid', prom: 'p-uid', cw: 'c-uid' } },
      new OutboundCallGuard(sink),
    );
  });

  it('POSTs to /api/datasources/proxy/uid/<uid>/loki/api/v1/query_range with bearer', async () => {
    const scope = nock('https://g', {
      reqheaders: { authorization: 'Bearer t' },
    })
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, lokiFixture);

    const r = await svc.queryLoki({
      logql: '{service="auth-service"} |~ "error"',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      limit: 500,
    });
    expect(scope.isDone()).toBe(true);
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].line).toContain('connection refused');
  });

  it('truncates lines to 1KB and respects limit', async () => {
    const huge = 'x'.repeat(5000);
    nock('https://g')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, {
        status: 'success',
        data: {
          result: [{ stream: {}, values: [['1', huge], ['2', 'short']] }],
        },
      });
    const r = await svc.queryLoki({
      logql: '{}',
      from: 'a',
      to: 'b',
      limit: 500,
    });
    expect(r.lines[0].line.length).toBeLessThanOrEqual(1024);
    expect(r.lines[1].line).toBe('short');
  });

  it('retries on 5xx', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(500, 'oops')
      .post('/api/datasources/proxy/uid/l-uid/loki/api/v1/query_range')
      .reply(200, lokiFixture);
    const r = await svc.queryLoki({ logql: '{}', from: 'a', to: 'b', limit: 500 });
    expect(r.lines.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 4: Write `apps/api/src/grafana/grafana.service.ts` (Loki only for now — Prom + CW + alerts in next tasks)**

Content:
```ts
import { Injectable } from '@nestjs/common';
import { OutboundCallGuard } from '../guard/outbound-call-guard';

export interface GrafanaServiceOpts {
  baseUrl: string;
  token: string;
  uids: { loki?: string; prom?: string; cw?: string };
}

export interface LokiQueryInput {
  logql: string;
  from: string;
  to: string;
  limit: number;
}

export interface LokiLine {
  ts: string;
  line: string;
}

export interface LokiResult {
  lines: LokiLine[];
  total_lines: number;
}

const MAX_LINE_BYTES = 1024;

function truncate(s: string): string {
  return s.length > MAX_LINE_BYTES ? s.slice(0, MAX_LINE_BYTES) : s;
}

@Injectable()
export class GrafanaService {
  constructor(
    private readonly opts: GrafanaServiceOpts,
    private readonly guard: OutboundCallGuard,
  ) {}

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}`, 'content-type': 'application/json' };
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/api/health'), { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  async queryLoki(input: LokiQueryInput): Promise<LokiResult> {
    const uid = this.opts.uids.loki;
    if (!uid) throw new Error('No Loki datasource UID configured');
    return this.guard.withGuard(
      { target: 'grafana', operation: 'query_loki' },
      async () => {
        const body = new URLSearchParams({
          query: input.logql,
          start: new Date(input.from).getTime() * 1_000_000 + '',
          end: new Date(input.to).getTime() * 1_000_000 + '',
          limit: String(input.limit),
        });
        const res = await fetch(
          this.url(`/api/datasources/proxy/uid/${uid}/loki/api/v1/query_range`),
          { method: 'POST', headers: this.headers(), body: body.toString() },
        );
        if (!res.ok) throw new Error(`Loki ${res.status}`);
        const json = (await res.json()) as {
          data?: { result?: Array<{ values?: [string, string][] }> };
        };
        const result = json.data?.result ?? [];
        const flat: LokiLine[] = [];
        for (const s of result) {
          for (const [ts, line] of s.values ?? []) {
            flat.push({ ts, line: truncate(line) });
            if (flat.length >= input.limit) break;
          }
          if (flat.length >= input.limit) break;
        }
        return { lines: flat, total_lines: flat.length };
      },
    );
  }
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/grafana/grafana.service.ts apps/api/test/fixtures/grafana/ apps/api/test/grafana.service.test.ts
git commit -m "feat(api): GrafanaService.queryLoki via datasource proxy"
```

### Task 7.3: Prometheus + CloudWatch methods

**Files:**
- Modify: `apps/api/src/grafana/grafana.service.ts`
- Create: `apps/api/test/fixtures/grafana/prom-rate.json`
- Create: `apps/api/test/fixtures/grafana/cw-cpu.json`
- Modify: `apps/api/test/grafana.service.test.ts` (append)

- [ ] **Step 1: Write `apps/api/test/fixtures/grafana/prom-rate.json`**

Content:
```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": [
      {
        "metric": { "service": "auth-service" },
        "values": [
          [1716364800, "10.5"],
          [1716364860, "11.2"],
          [1716364920, "12.0"]
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write `apps/api/test/fixtures/grafana/cw-cpu.json`**

Content:
```json
{
  "results": {
    "A": {
      "frames": [
        {
          "schema": { "fields": [{ "name": "Time" }, { "name": "CPUUtilization" }] },
          "data": {
            "values": [
              [1716364800000, 1716364860000, 1716364920000],
              [42.1, 45.3, 50.0]
            ]
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Append failing tests**

Append to `apps/api/test/grafana.service.test.ts`:
```ts
const promFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/prom-rate.json'), 'utf8'),
);
const cwFixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/grafana/cw-cpu.json'), 'utf8'),
);

describe('GrafanaService.queryProm', () => {
  it('returns [ts, value] tuples and downsamples to limit', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/p-uid/api/v1/query_range')
      .reply(200, promFixture);
    const svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l', prom: 'p-uid', cw: 'c' } },
      new OutboundCallGuard(sink),
    );
    const r = await svc.queryProm({
      promql: 'sum(rate(x[5m]))',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      step: '15s',
      maxPoints: 100,
    });
    expect(r.points.length).toBe(3);
    expect(r.points[0]).toEqual([1716364800, 10.5]);
  });
});

describe('GrafanaService.queryCloudWatch', () => {
  it('parses the dataframe response shape', async () => {
    nock('https://g')
      .post('/api/datasources/proxy/uid/c-uid/cloudwatch/metrics/query')
      .reply(200, cwFixture);
    const svc = new GrafanaService(
      { baseUrl: 'https://g', token: 't', uids: { loki: 'l', prom: 'p', cw: 'c-uid' } },
      new OutboundCallGuard(sink),
    );
    const r = await svc.queryCloudWatch({
      namespace: 'AWS/ECS',
      dimensions: { ClusterName: 'prod', ServiceName: 'auth' },
      metric: 'CPUUtilization',
      from: '2026-05-22T08:00:00Z',
      to: '2026-05-22T09:00:00Z',
      maxPoints: 100,
    });
    expect(r.points.length).toBe(3);
    expect(r.points[0][1]).toBe(42.1);
  });
});
```

- [ ] **Step 4: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 5: Append methods to `apps/api/src/grafana/grafana.service.ts`**

Append (before the closing brace of class):
```ts
  async queryProm(input: {
    promql: string;
    from: string;
    to: string;
    step: string;
    maxPoints: number;
  }): Promise<{ points: [number, number][] }> {
    const uid = this.opts.uids.prom;
    if (!uid) throw new Error('No Prometheus datasource UID configured');
    return this.guard.withGuard({ target: 'grafana', operation: 'query_prom' }, async () => {
      const body = new URLSearchParams({
        query: input.promql,
        start: String(Math.floor(new Date(input.from).getTime() / 1000)),
        end: String(Math.floor(new Date(input.to).getTime() / 1000)),
        step: input.step,
      });
      const res = await fetch(
        this.url(`/api/datasources/proxy/uid/${uid}/api/v1/query_range`),
        { method: 'POST', headers: this.headers(), body: body.toString() },
      );
      if (!res.ok) throw new Error(`Prom ${res.status}`);
      const json = (await res.json()) as {
        data?: { result?: Array<{ values?: [number, string][] }> };
      };
      const first = json.data?.result?.[0];
      const raw: [number, number][] = (first?.values ?? []).map(([t, v]) => [t, Number(v)]);
      const { lttb } = await import('@rca/agent');
      return { points: lttb(raw, input.maxPoints) };
    });
  }

  async queryCloudWatch(input: {
    namespace: string;
    dimensions: Record<string, string>;
    metric: string;
    from: string;
    to: string;
    maxPoints: number;
  }): Promise<{ points: [number, number][] }> {
    const uid = this.opts.uids.cw;
    if (!uid) throw new Error('No CloudWatch datasource UID configured');
    return this.guard.withGuard({ target: 'grafana', operation: 'query_cw' }, async () => {
      const body = JSON.stringify({
        queries: [
          {
            refId: 'A',
            namespace: input.namespace,
            metricName: input.metric,
            dimensions: input.dimensions,
            statistic: 'Average',
            period: '60',
          },
        ],
        from: String(new Date(input.from).getTime()),
        to: String(new Date(input.to).getTime()),
      });
      const res = await fetch(
        this.url(`/api/datasources/proxy/uid/${uid}/cloudwatch/metrics/query`),
        { method: 'POST', headers: this.headers(), body },
      );
      if (!res.ok) throw new Error(`CW ${res.status}`);
      const json = (await res.json()) as {
        results?: Record<
          string,
          { frames?: Array<{ data?: { values: number[][] } }> }
        >;
      };
      const frame = json.results?.A?.frames?.[0];
      const vals = frame?.data?.values ?? [];
      const ts = (vals[0] ?? []) as number[];
      const v = (vals[1] ?? []) as number[];
      const raw: [number, number][] = ts.map((t, i) => [t / 1000, v[i] ?? 0]);
      const { lttb } = await import('@rca/agent');
      return { points: lttb(raw, input.maxPoints) };
    });
  }

  async getAlertState(uid: string): Promise<string> {
    return this.guard.withGuard({ target: 'grafana', operation: 'alert_state' }, async () => {
      const res = await fetch(this.url(`/api/v1/provisioning/alert-rules/${uid}`), {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`AlertState ${res.status}`);
      const json = (await res.json()) as { state?: string };
      return json.state ?? 'unknown';
    });
  }
```

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/grafana/grafana.service.ts apps/api/test/fixtures/grafana/ apps/api/test/grafana.service.test.ts
git commit -m "feat(api): GrafanaService.queryProm + queryCloudWatch + getAlertState"
```

### Task 7.4: Grafana module + startup wiring

**Files:**
- Create: `apps/api/src/grafana/grafana.module.ts`

- [ ] **Step 1: Write `apps/api/src/grafana/grafana.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { OutboundCallGuard } from '../guard/outbound-call-guard';
import { EventsService } from '../events/events.service';
import { GrafanaService } from './grafana.service';
import { discoverDatasources } from './datasource-discovery';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [
    {
      provide: OutboundCallGuard,
      inject: [EventsService],
      useFactory: (e: EventsService) => new OutboundCallGuard(e),
    },
    {
      provide: GrafanaService,
      inject: [ConfigService, OutboundCallGuard],
      useFactory: async (c: ConfigService, guard: OutboundCallGuard) => {
        const discovered = await discoverDatasources({
          baseUrl: c.env.GRAFANA_URL,
          token: c.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
        });
        return new GrafanaService(
          {
            baseUrl: c.env.GRAFANA_URL,
            token: c.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
            uids: {
              loki: c.env.LOKI_DATASOURCE_UID ?? discovered.loki,
              prom: c.env.PROM_DATASOURCE_UID ?? discovered.prom,
              cw: c.env.CW_DATASOURCE_UID ?? discovered.cw,
            },
          },
          guard,
        );
      },
    },
  ],
  exports: [GrafanaService, OutboundCallGuard],
})
export class GrafanaModule {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/grafana/grafana.module.ts
git commit -m "feat(api): GrafanaModule wires discovery + OutboundCallGuard + EventsService"
```

---

## Phase 8 — Subagent runner + Coordinator

Implements spec §3.1–§3.3 + §3.6 (prompt caching) + §4.6 (SSE stream events). The Coordinator is the central piece: it pre-fetches data, spawns subagents in parallel, enforces quorum, and streams progress.

### Task 8.1: Prefetcher — parallel pulls per component

**Files:**
- Create: `apps/api/src/coordinator/prefetcher.ts`
- Test: `apps/api/test/prefetcher.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/prefetcher.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Prefetcher } from '../src/coordinator/prefetcher';
import type { Component } from '@rca/agent';

const components: Component[] = [
  {
    name: 'auth-service',
    type: 'service',
    description: 'd',
    loki: { selector: '{service="auth-service"}', error_filter: '|~ "error"' },
    prometheus: { metrics: [{ name: 'rps', query: 'sum(rate(http_requests_total[5m]))' }] },
  } as Component,
];

describe('Prefetcher', () => {
  it('runs loki + each prom metric in parallel and returns aggregated payload', async () => {
    const queryLoki = vi.fn().mockResolvedValue({ lines: [{ ts: '1', line: 'err' }], total_lines: 1 });
    const queryProm = vi.fn().mockResolvedValue({ points: [[1, 10]] });
    const queryCw = vi.fn();
    const pf = new Prefetcher({ queryLoki, queryProm, queryCloudWatch: queryCw } as any, { concurrency: 4 });

    const out = await pf.fetchAll(components, { from: 'a', to: 'b' });

    expect(queryLoki).toHaveBeenCalledTimes(1);
    expect(queryProm).toHaveBeenCalledTimes(1);
    expect(out['auth-service'].loki.error_lines.length).toBe(1);
    expect(out['auth-service'].prometheus.rps).toEqual([[1, 10]]);
  });

  it('records data_unavailable for a component when its grafana call rejects', async () => {
    const queryLoki = vi.fn().mockRejectedValue(new Error('Circuit open'));
    const pf = new Prefetcher(
      { queryLoki, queryProm: vi.fn(), queryCloudWatch: vi.fn() } as any,
      { concurrency: 4 },
    );
    const out = await pf.fetchAll(components, { from: 'a', to: 'b' });
    expect(out['auth-service'].data_unavailable).toBe(true);
  });

  it('caps concurrent in-flight grafana calls at the configured concurrency', async () => {
    let inflight = 0;
    let peak = 0;
    const slow = vi.fn().mockImplementation(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return { lines: [], total_lines: 0 };
    });
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `c${i}` as any,
      type: 'service' as const,
      description: '',
      loki: { selector: '{}' },
    })) as Component[];
    const pf = new Prefetcher(
      { queryLoki: slow, queryProm: vi.fn(), queryCloudWatch: vi.fn() } as any,
      { concurrency: 5 },
    );
    await pf.fetchAll(many, { from: 'a', to: 'b' });
    expect(peak).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/coordinator/prefetcher.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import type { Component } from '@rca/agent';
import type { GrafanaService } from '../grafana/grafana.service';

export interface PrefetchedComponent {
  window: { from: string; to: string };
  loki: {
    error_lines: { ts: string; line: string }[];
    stats: { total_lines: number };
  };
  prometheus: Record<string, [number, number][]>;
  cloudwatch: Record<string, [number, number][]>;
  data_unavailable: boolean;
}

export interface PrefetcherOpts {
  concurrency: number;
}

export class Prefetcher {
  constructor(
    private readonly grafana: GrafanaService,
    private readonly opts: PrefetcherOpts = { concurrency: 10 },
  ) {}

  async fetchAll(
    components: Component[],
    window: { from: string; to: string },
  ): Promise<Record<string, PrefetchedComponent>> {
    const semaphore = new Semaphore(this.opts.concurrency);
    const result: Record<string, PrefetchedComponent> = {};

    await Promise.all(
      components.map(async (c) => {
        result[c.name] = await this.fetchOne(c, window, semaphore);
      }),
    );
    return result;
  }

  private async fetchOne(
    c: Component,
    window: { from: string; to: string },
    sem: Semaphore,
  ): Promise<PrefetchedComponent> {
    const out: PrefetchedComponent = {
      window,
      loki: { error_lines: [], stats: { total_lines: 0 } },
      prometheus: {},
      cloudwatch: {},
      data_unavailable: false,
    };
    const tasks: Promise<void>[] = [];

    if (c.loki) {
      const logql = c.loki.error_filter
        ? `${c.loki.selector} ${c.loki.error_filter}`
        : c.loki.selector;
      tasks.push(
        sem.with(async () => {
          try {
            const r = await this.grafana.queryLoki({
              logql,
              from: window.from,
              to: window.to,
              limit: 500,
            });
            out.loki.error_lines = r.lines;
            out.loki.stats.total_lines = r.total_lines;
          } catch {
            out.data_unavailable = true;
          }
        }),
      );
    }

    for (const m of c.prometheus?.metrics ?? []) {
      tasks.push(
        sem.with(async () => {
          try {
            const r = await this.grafana.queryProm({
              promql: m.query,
              from: window.from,
              to: window.to,
              step: '60s',
              maxPoints: 100,
            });
            out.prometheus[m.name] = r.points;
          } catch {
            out.data_unavailable = true;
          }
        }),
      );
    }

    if (c.cloudwatch) {
      for (const metric of c.cloudwatch.metrics) {
        tasks.push(
          sem.with(async () => {
            try {
              const r = await this.grafana.queryCloudWatch({
                namespace: c.cloudwatch!.namespace,
                dimensions: c.cloudwatch!.dimensions,
                metric,
                from: window.from,
                to: window.to,
                maxPoints: 100,
              });
              out.cloudwatch[metric] = r.points;
            } catch {
              out.data_unavailable = true;
            }
          }),
        );
      }
    }

    await Promise.all(tasks);
    return out;
  }
}

class Semaphore {
  private available: number;
  private queue: (() => void)[] = [];
  constructor(n: number) {
    this.available = n;
  }
  async with<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((res) => this.queue.push(res));
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available++;
  }
}

@Injectable()
export class PrefetcherService extends Prefetcher {}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/coordinator/prefetcher.ts apps/api/test/prefetcher.test.ts
git commit -m "feat(api): Prefetcher with semaphore-capped concurrent grafana calls"
```

### Task 8.2: SSE stream bus

In-memory pub/sub keyed by `run_id`. The HTTP controller (Phase 10) hooks into it.

**Files:**
- Create: `apps/api/src/coordinator/stream.ts`
- Test: `apps/api/test/stream.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/stream.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RunStreamBus } from '../src/coordinator/stream';

describe('RunStreamBus', () => {
  it('delivers events to subscribers and buffers late subscribers up to N events', async () => {
    const bus = new RunStreamBus();
    bus.publish('run-1', { event: 'iteration_start', data: { iteration: 1 } });
    bus.publish('run-1', { event: 'subagent_done', data: { component: 'x' } });

    const seen: any[] = [];
    const unsub = bus.subscribe('run-1', (msg) => seen.push(msg.event));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['iteration_start', 'subagent_done']);
    unsub();
  });

  it('delivers live events after subscription', async () => {
    const bus = new RunStreamBus();
    const seen: string[] = [];
    bus.subscribe('run-2', (m) => seen.push(m.event));
    bus.publish('run-2', { event: 'run_complete', data: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain('run_complete');
  });

  it('ends a run and drops its buffer after the configured ttl', async () => {
    const bus = new RunStreamBus({ replayLimit: 10, ttlMs: 5 });
    bus.publish('run-3', { event: 'x', data: {} });
    bus.endRun('run-3');
    await new Promise((r) => setTimeout(r, 20));
    expect(bus.snapshot('run-3')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/coordinator/stream.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';

export interface RunMessage {
  event: string;
  data: unknown;
}
export type RunListener = (msg: RunMessage) => void;

export interface RunStreamBusOptions {
  replayLimit?: number;
  ttlMs?: number;
}

interface RunChannel {
  buffer: RunMessage[];
  listeners: Set<RunListener>;
  ended: boolean;
}

@Injectable()
export class RunStreamBus {
  private channels = new Map<string, RunChannel>();
  private readonly replayLimit: number;
  private readonly ttlMs: number;

  constructor(opts: RunStreamBusOptions = {}) {
    this.replayLimit = opts.replayLimit ?? 200;
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
  }

  private ch(runId: string): RunChannel {
    let c = this.channels.get(runId);
    if (!c) {
      c = { buffer: [], listeners: new Set(), ended: false };
      this.channels.set(runId, c);
    }
    return c;
  }

  publish(runId: string, msg: RunMessage): void {
    const c = this.ch(runId);
    c.buffer.push(msg);
    if (c.buffer.length > this.replayLimit) c.buffer.shift();
    for (const l of c.listeners) {
      queueMicrotask(() => l(msg));
    }
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const c = this.ch(runId);
    for (const m of c.buffer) queueMicrotask(() => listener(m));
    c.listeners.add(listener);
    return () => c.listeners.delete(listener);
  }

  endRun(runId: string): void {
    const c = this.ch(runId);
    c.ended = true;
    setTimeout(() => this.channels.delete(runId), this.ttlMs);
  }

  snapshot(runId: string): RunMessage[] {
    return this.channels.get(runId)?.buffer ?? [];
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/coordinator/stream.ts apps/api/test/stream.test.ts
git commit -m "feat(api): RunStreamBus for SSE event distribution"
```

### Task 8.3: Dependency bus (intra-cycle lookups)

Per spec §2.4 — subagents publish preliminary findings; a sibling can `lookup_dependency()` and see them.

**Files:**
- Create: `apps/api/src/coordinator/dependency-bus.ts`
- Test: append to `apps/api/test/coordinator.test.ts` (file created in next task)

- [ ] **Step 1: Write `apps/api/src/coordinator/dependency-bus.ts`**

Content:
```ts
import type { SubagentOutput } from '@rca/agent';

export class DependencyBus {
  private preliminary = new Map<string, Partial<SubagentOutput>>();

  publish(component: string, preliminary: Partial<SubagentOutput>): void {
    this.preliminary.set(component, preliminary);
  }

  lookup(component: string): Partial<SubagentOutput> | undefined {
    return this.preliminary.get(component);
  }

  reset(): void {
    this.preliminary.clear();
  }
}
```

### Task 8.4: Prompt builder for subagents + synthesizer

Implements §3.1 (renderSubagentPrompt is already in Phase 2; this builds the full per-call system+user pair) and §3.6 (cache_control markers).

**Files:**
- Create: `apps/agent/src/prompt-builder.ts`
- Test: `apps/agent/test/prompt-builder.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/agent/test/prompt-builder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSubagentCall, buildSynthesizerCall } from '../src/prompt-builder';

describe('buildSubagentCall', () => {
  it('returns systemPrompt with prose marked cacheable + user payload with prefetch', () => {
    const { systemPrompt, userPayload, agentName } = buildSubagentCall({
      componentName: 'auth-service',
      promptMd: 'GENERATED PROMPT FILE',
      window: { from: 'a', to: 'b' },
      prefetched: { window: { from: 'a', to: 'b' }, loki: { error_lines: [], stats: { total_lines: 0 } }, prometheus: {}, cloudwatch: {}, data_unavailable: false },
    });
    expect(agentName).toBe('auth-service-investigator');
    expect(systemPrompt).toContain('GENERATED PROMPT FILE');
    expect((userPayload as any).window.from).toBe('a');
    expect((userPayload as any).prefetched).toBeDefined();
  });
});

describe('buildSynthesizerCall', () => {
  it('packs all subagent outputs + dependency graph + past RCAs', () => {
    const c = buildSynthesizerCall({
      infraMd: 'INFRA MD CONTENT',
      dependencyGraph: { a: ['b'] },
      subagentOutputs: [{ component: 'a' } as any],
      pastRcas: [{ id: 'r1', summary: 's' }],
      window: { from: 'a', to: 'b' },
    });
    expect(c.systemPrompt).toContain('INFRA MD CONTENT');
    expect(c.systemPrompt).toContain('synthesizer');
    expect((c.userPayload as any).subagent_outputs.length).toBe(1);
    expect((c.userPayload as any).past_rcas.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/agent test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/agent/src/prompt-builder.ts`**

Content:
```ts
import type { SubagentOutput } from './schemas/subagent-output';

export interface BuildSubagentInput {
  componentName: string;
  promptMd: string;
  window: { from: string; to: string };
  prefetched: unknown;
}

export interface BuildSubagentResult {
  agentName: string;
  systemPrompt: string;
  userPayload: unknown;
}

export function buildSubagentCall(input: BuildSubagentInput): BuildSubagentResult {
  return {
    agentName: `${input.componentName}-investigator`,
    systemPrompt: input.promptMd,
    userPayload: {
      window: input.window,
      prefetched: input.prefetched,
      instructions:
        'Analyse the prefetched data. Drill in via tools if needed. Return ONLY JSON matching the schema in your system prompt.',
    },
  };
}

export interface PastRcaSummary {
  id: string;
  summary: string;
  resolution_note?: string;
  resolution_steps?: string[];
}

export interface BuildSynthesizerInput {
  infraMd: string;
  dependencyGraph: Record<string, string[]>;
  subagentOutputs: SubagentOutput[];
  pastRcas: PastRcaSummary[];
  window: { from: string; to: string };
}

export interface BuildSynthesizerResult {
  agentName: string;
  systemPrompt: string;
  userPayload: unknown;
}

export function buildSynthesizerCall(input: BuildSynthesizerInput): BuildSynthesizerResult {
  const system = `You are the RCA synthesizer.

# Full infrastructure context (cached across runs)
${input.infraMd}

# Output format — REQUIRED
Return ONLY a JSON object matching this schema:
{
  "summary": "one-paragraph TL;DR",
  "root_cause": { "component": "...", "description": "...", "confidence": 0.0-1.0 },
  "contributing_factors": [{ "component": "...", "description": "...", "severity": "info|warn|error|critical" }],
  "timeline": [{ "ts": "ISO string", "event": "..." }],
  "evidence": [{ "component": "...", "type": "log|metric|cw", "ref": "...", "excerpt": "..." }],
  "suggested_next_steps": ["..."],
  "similar_past_rcas": ["rca_id_1", "..."]
}

Rules:
- Cite evidence from the subagent outputs ONLY.
- If a component's dependencies are degraded AND it is degraded, blame the dependency.
- If past RCAs include resolution notes, lean on them.
`;
  return {
    agentName: 'synthesizer',
    systemPrompt: system,
    userPayload: {
      window: input.window,
      dependency_graph: input.dependencyGraph,
      subagent_outputs: input.subagentOutputs,
      past_rcas: input.pastRcas,
    },
  };
}
```

- [ ] **Step 4: Re-export from index.ts**

Append to `apps/agent/src/index.ts`:
```ts
export * from './prompt-builder';
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/agent test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/prompt-builder.ts apps/agent/src/index.ts apps/agent/test/prompt-builder.test.ts
git commit -m "feat(agent): prompt-builder for subagent + synthesizer calls"
```

### Task 8.5: Subagent runner (one call, schema-validated, 90s timeout, 1 retry)

**Files:**
- Create: `apps/api/src/coordinator/subagent-runner.ts`
- Test: `apps/api/test/subagent-runner.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/subagent-runner.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { StubClaudeClient } from '@rca/agent';

describe('SubagentRunner', () => {
  it('returns parsed SubagentOutput on success', async () => {
    const client = new StubClaudeClient({
      'auth-service-investigator': () => ({
        component: 'auth-service',
        status: 'healthy',
        confidence: 0.9,
        findings: [],
        suspected_dependencies: [],
        notes: 'ok',
      }),
    });
    const runner = new SubagentRunner(client, { timeoutMs: 200 });
    const out = await runner.run({
      componentName: 'auth-service',
      promptMd: 'PROMPT',
      window: { from: 'a', to: 'b' },
      prefetched: {},
    });
    expect(out.output.status).toBe('healthy');
    expect(out.tokens.input).toBeGreaterThan(0);
  });

  it('treats invalid JSON as inconclusive with notes', async () => {
    const client = { run: vi.fn().mockResolvedValue({ text: 'not json', tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1 }) };
    const runner = new SubagentRunner(client as any, { timeoutMs: 200 });
    const out = await runner.run({
      componentName: 'x',
      promptMd: 'p',
      window: { from: 'a', to: 'b' },
      prefetched: {},
    });
    expect(out.output.status).toBe('inconclusive');
    expect(out.output.notes).toMatch(/json/i);
  });

  it('retries once on a thrown error then succeeds', async () => {
    let n = 0;
    const client = {
      run: vi.fn().mockImplementation(async () => {
        n++;
        if (n === 1) throw new Error('5xx');
        return {
          text: JSON.stringify({
            component: 'x',
            status: 'healthy',
            confidence: 0.9,
            findings: [],
            suspected_dependencies: [],
            notes: '',
          }),
          tokensIn: 100,
          tokensOut: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          durationMs: 1,
        };
      }),
    };
    const runner = new SubagentRunner(client as any, { timeoutMs: 200 });
    const out = await runner.run({ componentName: 'x', promptMd: 'p', window: { from: 'a', to: 'b' }, prefetched: {} });
    expect(out.output.status).toBe('healthy');
    expect(client.run).toHaveBeenCalledTimes(2);
  });

  it('returns inconclusive with notes="timeout" when timeout fires', async () => {
    const client = {
      run: vi.fn().mockImplementation(
        async () => new Promise((r) => setTimeout(() => r({ text: '{}', tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1 }), 200)),
      ),
    };
    const runner = new SubagentRunner(client as any, { timeoutMs: 20 });
    const out = await runner.run({ componentName: 'slow', promptMd: 'p', window: { from: 'a', to: 'b' }, prefetched: {} });
    expect(out.output.notes).toBe('timeout');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/coordinator/subagent-runner.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import {
  buildSubagentCall,
  SubagentOutputSchema,
  type ClaudeClient,
  type SubagentOutput,
} from '@rca/agent';

export interface SubagentRunInput {
  componentName: string;
  promptMd: string;
  window: { from: string; to: string };
  prefetched: unknown;
}

export interface SubagentRunResult {
  output: SubagentOutput;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  durationMs: number;
}

export interface SubagentRunnerOpts {
  timeoutMs: number;
}

@Injectable()
export class SubagentRunner {
  constructor(
    private readonly claude: ClaudeClient,
    private readonly opts: SubagentRunnerOpts = { timeoutMs: 90_000 },
  ) {}

  async run(input: SubagentRunInput): Promise<SubagentRunResult> {
    const call = buildSubagentCall(input);
    const attempts = 2;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs);
        const r = await this.claude.run({
          agentName: call.agentName,
          systemPrompt: call.systemPrompt,
          userPayload: call.userPayload,
          timeoutMs: this.opts.timeoutMs,
          signal: ac.signal,
        });
        clearTimeout(timer);

        const parsed = parseSubagentJson(r.text, input.componentName);
        return {
          output: parsed,
          tokens: {
            input: r.tokensIn,
            output: r.tokensOut,
            cache_read: r.cacheReadTokens,
            cache_write: r.cacheWriteTokens,
          },
          durationMs: r.durationMs,
        };
      } catch (err) {
        lastError = err as Error;
        if ((err as Error).name === 'AbortError' || (err as Error).message?.includes('abort')) {
          return inconclusive(input.componentName, 'timeout', 0);
        }
      }
    }
    return inconclusive(input.componentName, `error: ${lastError?.message ?? 'unknown'}`, 0);
  }
}

function parseSubagentJson(text: string, componentName: string): SubagentOutput {
  let parsed: unknown;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return {
      component: componentName,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes: 'json parse error',
    };
  }
  const r = SubagentOutputSchema.safeParse(parsed);
  if (!r.success) {
    return {
      component: componentName,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes: `schema validation failed: ${r.error.message.slice(0, 200)}`,
    };
  }
  return r.data;
}

function inconclusive(component: string, notes: string, _attempts: number): SubagentRunResult {
  return {
    output: {
      component,
      status: 'inconclusive',
      confidence: 0,
      findings: [],
      suspected_dependencies: [],
      notes,
    },
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    durationMs: 0,
  };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/coordinator/subagent-runner.ts apps/api/test/subagent-runner.test.ts
git commit -m "feat(api): SubagentRunner with timeout + retry + schema-validated parse"
```

### Task 8.6: Coordinator service — orchestrates one iteration

Implements spec §3.3 (full coordinator responsibilities, minus the expand-window loop which is Phase 9).

**Files:**
- Create: `apps/api/src/coordinator/coordinator.service.ts`
- Test: `apps/api/test/coordinator.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/coordinator.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinatorService } from '../src/coordinator/coordinator.service';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { Prefetcher } from '../src/coordinator/prefetcher';
import { RunStreamBus } from '../src/coordinator/stream';
import { DependencyBus } from '../src/coordinator/dependency-bus';
import { StubClaudeClient } from '@rca/agent';

const components = [
  {
    name: 'a',
    type: 'service' as const,
    description: 'A',
    loki: { selector: '{a}' },
  },
  {
    name: 'b',
    type: 'service' as const,
    description: 'B',
    loki: { selector: '{b}' },
  },
];

function makeStub(map: Record<string, any>) {
  const responders: Record<string, any> = {};
  for (const k of Object.keys(map)) {
    responders[`${k}-investigator`] = () => map[k];
  }
  return new StubClaudeClient(responders);
}

const fakeGrafana = {
  queryLoki: vi.fn().mockResolvedValue({ lines: [], total_lines: 0 }),
  queryProm: vi.fn().mockResolvedValue({ points: [] }),
  queryCloudWatch: vi.fn(),
} as any;

describe('CoordinatorService.runOneIteration', () => {
  let coord: CoordinatorService;
  let bus: RunStreamBus;
  beforeEach(() => {
    bus = new RunStreamBus();
  });

  it('runs all subagents and returns their outputs', async () => {
    const stub = makeStub({
      a: { component: 'a', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
      b: { component: 'b', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
    });
    const runner = new SubagentRunner(stub, { timeoutMs: 200 });
    coord = new CoordinatorService(
      runner,
      new Prefetcher(fakeGrafana, { concurrency: 4 }),
      bus,
      new DependencyBus(),
    );
    const r = await coord.runOneIteration({
      runId: 'r1',
      components,
      promptMdByComponent: { a: 'prompt-a', b: 'prompt-b' },
      window: { from: 'a', to: 'b' },
    });
    expect(r.outputs).toHaveLength(2);
    expect(r.outputs.every((o) => o.status === 'healthy')).toBe(true);
  });

  it('emits SSE events: iteration_start, subagent_done x N, prefetch_done', async () => {
    const stub = makeStub({
      a: { component: 'a', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
      b: { component: 'b', status: 'healthy', confidence: 0.95, findings: [], suspected_dependencies: [], notes: '' },
    });
    const runner = new SubagentRunner(stub, { timeoutMs: 200 });
    const events: string[] = [];
    bus.subscribe('r2', (m) => events.push(m.event));
    coord = new CoordinatorService(
      runner,
      new Prefetcher(fakeGrafana, { concurrency: 4 }),
      bus,
      new DependencyBus(),
    );
    await coord.runOneIteration({
      runId: 'r2',
      components,
      promptMdByComponent: { a: 'prompt-a', b: 'prompt-b' },
      window: { from: 'a', to: 'b' },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(events).toContain('iteration_start');
    expect(events).toContain('prefetch_done');
    expect(events.filter((e) => e === 'subagent_done')).toHaveLength(2);
  });

  it('quorumMet returns true when >= 6 of 9 are usable', async () => {
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      component: `c${i}`,
      status: i < 6 ? 'healthy' : 'inconclusive',
      confidence: i < 6 ? 0.8 : 0,
      findings: [],
      suspected_dependencies: [],
      notes: '',
    }));
    expect(CoordinatorService.quorumMet(outputs as any, 9, 6)).toBe(true);
  });

  it('quorumMet returns false when too many are inconclusive', async () => {
    const outputs = Array.from({ length: 9 }, (_, i) => ({
      component: `c${i}`,
      status: i < 5 ? 'healthy' : 'inconclusive',
      confidence: i < 5 ? 0.8 : 0,
      findings: [],
      suspected_dependencies: [],
      notes: '',
    }));
    expect(CoordinatorService.quorumMet(outputs as any, 9, 6)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/coordinator/coordinator.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import type { Component, SubagentOutput } from '@rca/agent';
import { SubagentRunner, type SubagentRunResult } from './subagent-runner';
import { Prefetcher, type PrefetchedComponent } from './prefetcher';
import { RunStreamBus } from './stream';
import { DependencyBus } from './dependency-bus';

export interface OneIterationInput {
  runId: string;
  components: Component[];
  promptMdByComponent: Record<string, string>;
  window: { from: string; to: string };
}

export interface OneIterationResult {
  outputs: SubagentOutput[];
  totalTokens: { input: number; output: number; cache_read: number; cache_write: number };
  prefetched: Record<string, PrefetchedComponent>;
}

@Injectable()
export class CoordinatorService {
  constructor(
    private readonly runner: SubagentRunner,
    private readonly prefetcher: Prefetcher,
    private readonly bus: RunStreamBus,
    private readonly deps: DependencyBus,
  ) {}

  async runOneIteration(input: OneIterationInput): Promise<OneIterationResult> {
    this.bus.publish(input.runId, {
      event: 'iteration_start',
      data: { window: input.window },
    });

    const prefetched = await this.prefetcher.fetchAll(input.components, input.window);
    this.bus.publish(input.runId, { event: 'prefetch_done', data: { components: Object.keys(prefetched) } });

    this.deps.reset();
    const results = await Promise.all(
      input.components.map(async (c) => {
        this.bus.publish(input.runId, { event: 'subagent_progress', data: { component: c.name, status: 'running' } });
        const res = await this.runner.run({
          componentName: c.name,
          promptMd: input.promptMdByComponent[c.name] ?? '',
          window: input.window,
          prefetched: prefetched[c.name],
        });
        this.deps.publish(c.name, res.output);
        this.bus.publish(input.runId, { event: 'subagent_done', data: { component: c.name, output: res.output } });
        return res;
      }),
    );

    return aggregate(results, prefetched);
  }

  static quorumMet(outputs: SubagentOutput[], total: number, threshold: number): boolean {
    const usable = outputs.filter((o) => o.status !== 'inconclusive').length;
    return usable >= Math.min(threshold, total);
  }
}

function aggregate(
  results: SubagentRunResult[],
  prefetched: Record<string, PrefetchedComponent>,
): OneIterationResult {
  const totalTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const r of results) {
    totalTokens.input += r.tokens.input;
    totalTokens.output += r.tokens.output;
    totalTokens.cache_read += r.tokens.cache_read;
    totalTokens.cache_write += r.tokens.cache_write;
  }
  return { outputs: results.map((r) => r.output), totalTokens, prefetched };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/coordinator/coordinator.service.ts apps/api/src/coordinator/dependency-bus.ts apps/api/test/coordinator.test.ts
git commit -m "feat(api): CoordinatorService one-iteration orchestration + quorum check"
```

### Task 8.7: Coordinator module

**Files:**
- Create: `apps/api/src/coordinator/coordinator.module.ts`

- [ ] **Step 1: Write `apps/api/src/coordinator/coordinator.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { CLAUDE_CLIENT, RealClaudeClient, type ClaudeClient } from '@rca/agent';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { GrafanaModule } from '../grafana/grafana.module';
import { GrafanaService } from '../grafana/grafana.service';
import { CoordinatorService } from './coordinator.service';
import { SubagentRunner } from './subagent-runner';
import { Prefetcher } from './prefetcher';
import { RunStreamBus } from './stream';
import { DependencyBus } from './dependency-bus';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: CLAUDE_CLIENT,
      useFactory: (): ClaudeClient =>
        new RealClaudeClient({
          queryFn: query as any,
          defaultModel: 'claude-sonnet-4-6',
          maxTurns: 8,
        }),
    },
    {
      provide: SubagentRunner,
      inject: [CLAUDE_CLIENT],
      useFactory: (c: ClaudeClient) => new SubagentRunner(c, { timeoutMs: 90_000 }),
    },
    {
      provide: Prefetcher,
      inject: [GrafanaService],
      useFactory: (g: GrafanaService) => new Prefetcher(g, { concurrency: 10 }),
    },
    RunStreamBus,
    DependencyBus,
    CoordinatorService,
  ],
  exports: [CoordinatorService, RunStreamBus, DependencyBus, SubagentRunner, CLAUDE_CLIENT],
})
export class CoordinatorModule {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/coordinator/coordinator.module.ts
git commit -m "feat(api): CoordinatorModule wires real Claude SDK + Grafana"
```

---

## Phase 9 — Synthesizer, past-RCA lookup, stop hook, expand-window loop, Slack

This phase wires up the actual RCA cycle end-to-end on top of `CoordinatorService.runOneIteration`.

### Task 9.1: Past-RCA lookup

Implements spec §3.5.

**Files:**
- Create: `apps/api/src/synthesizer/past-rca-lookup.ts`
- Test: `apps/api/test/past-rca-lookup.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/past-rca-lookup.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId } from 'mongodb';
import { RcasRepo } from '../src/mongo/rcas.repo';
import { ResolutionsRepo } from '../src/mongo/resolutions.repo';
import { PastRcaLookup } from '../src/synthesizer/past-rca-lookup';

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});

beforeEach(async () => {
  await client.db('rca').collection('rcas').deleteMany({});
  await client.db('rca').collection('resolutions').deleteMany({});
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe('PastRcaLookup', () => {
  it('returns up to 3 resolved RCAs per component, top by recency, deduped', async () => {
    const rcas = new RcasRepo(client.db('rca'));
    const lookup = new PastRcaLookup(rcas, new ResolutionsRepo(client.db('rca')));

    for (let i = 0; i < 5; i++) {
      const id = await rcas.create({
        runId: new ObjectId().toHexString(),
        window: { from: 'a', to: 'b' },
        rca: {
          summary: `r${i}`,
          root_cause: { component: 'postgres-primary', description: '', confidence: 0.9 },
          contributing_factors: [],
          timeline: [],
          evidence: [],
          suggested_next_steps: [],
          similar_past_rcas: [],
        },
      });
      await rcas.markResolved(id, `note ${i}`, [`step ${i}`]);
    }

    const r = await lookup.fetch(['postgres-primary']);
    expect(r.length).toBe(3);
    expect(r.every((p) => p.resolution_note)).toBe(true);
  });

  it('returns empty when no past RCAs match', async () => {
    const lookup = new PastRcaLookup(
      new RcasRepo(client.db('rca')),
      new ResolutionsRepo(client.db('rca')),
    );
    expect(await lookup.fetch(['nothing'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/synthesizer/past-rca-lookup.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import type { PastRcaSummary } from '@rca/agent';
import { RcasRepo } from '../mongo/rcas.repo';
import { ResolutionsRepo } from '../mongo/resolutions.repo';

@Injectable()
export class PastRcaLookup {
  constructor(
    private readonly rcas: RcasRepo,
    private readonly resolutions: ResolutionsRepo,
  ) {}

  async fetch(components: string[]): Promise<PastRcaSummary[]> {
    const seen = new Set<string>();
    const all: { id: string; createdAt: Date; summary: string; rcaId: string }[] = [];

    for (const c of components) {
      const recent = await this.rcas.findRecentResolvedByComponent(c, 3);
      for (const r of recent) {
        const id = r._id.toHexString();
        if (seen.has(id)) continue;
        seen.add(id);
        all.push({ id, createdAt: r.resolved_at ?? r.created_at, summary: r.rca.summary, rcaId: id });
      }
    }
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const top3 = all.slice(0, 3);
    const out: PastRcaSummary[] = [];
    for (const p of top3) {
      const res = await this.resolutions.findByRcaId(p.rcaId);
      const doc = await this.rcas.findById(p.rcaId);
      out.push({
        id: p.id,
        summary: p.summary,
        resolution_note: res?.note ?? doc?.resolution_note,
        resolution_steps: res?.steps ?? doc?.resolution_steps,
      });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/synthesizer/past-rca-lookup.ts apps/api/test/past-rca-lookup.test.ts
git commit -m "feat(api): past-RCA lookup keyed by suspect components"
```

### Task 9.2: SynthesizerService

**Files:**
- Create: `apps/api/src/synthesizer/synthesizer.service.ts`
- Create: `apps/api/src/synthesizer/synthesizer.module.ts`
- Test: `apps/api/test/synthesizer.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/synthesizer.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SynthesizerService } from '../src/synthesizer/synthesizer.service';
import { StubClaudeClient } from '@rca/agent';

describe('SynthesizerService', () => {
  it('returns a validated RcaOutput on success', async () => {
    const stub = new StubClaudeClient({
      synthesizer: () => ({
        summary: 's',
        root_cause: { component: 'postgres-primary', description: 'pool exhausted', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: ['raise pool'],
        similar_past_rcas: [],
      }),
    });
    const synth = new SynthesizerService(stub);
    const out = await synth.synthesize({
      infraMd: 'INFRA',
      dependencyGraph: {},
      subagentOutputs: [],
      pastRcas: [],
      window: { from: 'a', to: 'b' },
    });
    expect(out.rca.root_cause.component).toBe('postgres-primary');
    expect(out.degraded).toBe(false);
  });

  it('marks degraded=true on invalid JSON and returns a fallback RCA', async () => {
    const client = {
      run: async () => ({
        text: 'totally not json',
        tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 1,
      }),
    };
    const synth = new SynthesizerService(client as any);
    const out = await synth.synthesize({
      infraMd: '', dependencyGraph: {}, subagentOutputs: [], pastRcas: [], window: { from: 'a', to: 'b' },
    });
    expect(out.degraded).toBe(true);
    expect(out.rca.summary).toMatch(/synthesizer/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/synthesizer/synthesizer.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import {
  buildSynthesizerCall,
  RcaOutputSchema,
  type ClaudeClient,
  type PastRcaSummary,
  type RcaOutput,
  type SubagentOutput,
} from '@rca/agent';

export interface SynthesizeInput {
  infraMd: string;
  dependencyGraph: Record<string, string[]>;
  subagentOutputs: SubagentOutput[];
  pastRcas: PastRcaSummary[];
  window: { from: string; to: string };
}

export interface SynthesizeResult {
  rca: RcaOutput;
  degraded: boolean;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
}

@Injectable()
export class SynthesizerService {
  constructor(private readonly claude: ClaudeClient) {}

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const call = buildSynthesizerCall(input);
    try {
      const r = await this.claude.run({
        agentName: call.agentName,
        systemPrompt: call.systemPrompt,
        userPayload: call.userPayload,
        timeoutMs: 90_000,
      });
      const match = r.text.match(/\{[\s\S]*\}/);
      const json = JSON.parse(match ? match[0] : r.text);
      const parsed = RcaOutputSchema.safeParse(json);
      if (!parsed.success) return fallback(r);
      return {
        rca: parsed.data,
        degraded: false,
        tokens: {
          input: r.tokensIn,
          output: r.tokensOut,
          cache_read: r.cacheReadTokens,
          cache_write: r.cacheWriteTokens,
        },
      };
    } catch {
      return fallback(undefined);
    }
  }
}

function fallback(r: { tokensIn?: number; tokensOut?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | undefined): SynthesizeResult {
  return {
    rca: {
      summary: 'synthesizer produced invalid JSON — partial RCA returned',
      root_cause: { component: 'unknown', description: 'synthesizer failed', confidence: 0 },
      contributing_factors: [],
      timeline: [],
      evidence: [],
      suggested_next_steps: ['retry RCA', 'inspect logs for synthesizer error'],
      similar_past_rcas: [],
    },
    degraded: true,
    tokens: {
      input: r?.tokensIn ?? 0,
      output: r?.tokensOut ?? 0,
      cache_read: r?.cacheReadTokens ?? 0,
      cache_write: r?.cacheWriteTokens ?? 0,
    },
  };
}
```

- [ ] **Step 4: Write `apps/api/src/synthesizer/synthesizer.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { CLAUDE_CLIENT } from '@rca/agent';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { SynthesizerService } from './synthesizer.service';
import { PastRcaLookup } from './past-rca-lookup';
import { MongoService } from '../mongo/mongo.service';
import { RcasRepo } from '../mongo/rcas.repo';
import { ResolutionsRepo } from '../mongo/resolutions.repo';

@Module({
  imports: [CoordinatorModule],
  providers: [
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    { provide: ResolutionsRepo, inject: [MongoService], useFactory: (m: MongoService) => new ResolutionsRepo(m.db()) },
    PastRcaLookup,
    {
      provide: SynthesizerService,
      inject: [CLAUDE_CLIENT],
      useFactory: (c) => new SynthesizerService(c),
    },
  ],
  exports: [SynthesizerService, PastRcaLookup, RcasRepo, ResolutionsRepo],
})
export class SynthesizerModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/synthesizer/ apps/api/test/synthesizer.test.ts
git commit -m "feat(api): SynthesizerService with degraded fallback"
```

### Task 9.3: StopHook service

Implements spec §4.2.

**Files:**
- Create: `apps/api/src/stop-hook/stop-hook.service.ts`
- Create: `apps/api/src/stop-hook/stop-hook.module.ts`
- Test: `apps/api/test/stop-hook.test.ts`

- [ ] **Step 1: Write failing test (covers spec §6.3 row-for-row)**

File `apps/api/test/stop-hook.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { StopHookService } from '../src/stop-hook/stop-hook.service';

function rca(confidence: number, evidence: any[] = []) {
  return {
    summary: 's',
    root_cause: { component: 'c', description: '', confidence },
    contributing_factors: [],
    timeline: [],
    evidence,
    suggested_next_steps: [],
    similar_past_rcas: [],
  };
}

describe('StopHookService.evaluate', () => {
  const window24h = { from: '2026-05-21T00:00:00Z', to: '2026-05-22T00:00:00Z' };
  const window4h = { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' };
  const cfg = { confidenceThreshold: 0.75, baselineTolerance: 0.2, windowMaxHours: 24 };

  const fakeGrafana: any = {
    getAlertState: vi.fn(),
    queryProm: vi.fn().mockResolvedValue({ points: [[1, 0]] }),
  };

  it('time_capped at window cap regardless of confidence', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.9, [{}]), run: { trigger: 'manual' } as any, window: window24h });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('time_capped');
  });

  it('manual + confident + evidenced → stop success', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.9, [{}]), run: { trigger: 'manual' } as any, window: window4h });
    expect(r.stop).toBe(true);
    expect(r.reason).toBe('success');
  });

  it('low confidence → not meaningful yet', async () => {
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({ rca: rca(0.3, []), run: { trigger: 'manual' } as any, window: window4h });
    expect(r.stop).toBe(false);
  });

  it('confident + alert state firing → ongoing', async () => {
    fakeGrafana.getAlertState.mockResolvedValue('alerting');
    const svc = new StopHookService(fakeGrafana, cfg);
    const r = await svc.evaluate({
      rca: rca(0.9, [{}]),
      run: { trigger: 'webhook', alert_uid: 'u-1', alert_query: 'sum(rate(x[5m]))' } as any,
      window: window4h,
    });
    expect(r.stop).toBe(false);
    expect(r.reason).toBe('rca_good_but_incident_ongoing');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/stop-hook/stop-hook.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import { detectMetricBackToBaseline } from '@rca/agent';
import type { GrafanaService } from '../grafana/grafana.service';
import type { RcaOutput } from '@rca/agent';

export interface StopHookConfig {
  confidenceThreshold: number;
  baselineTolerance: number;
  windowMaxHours: number;
}

export interface StopHookRun {
  trigger: 'manual' | 'webhook' | 'health';
  alert_uid?: string;
  alert_query?: string;
}

export interface EvaluateInput {
  rca: RcaOutput;
  run: StopHookRun;
  window: { from: string; to: string };
}

export interface StopDecision {
  stop: boolean;
  reason: 'success' | 'time_capped' | 'not_meaningful_yet' | 'rca_good_but_incident_ongoing';
  details?: Record<string, unknown>;
}

@Injectable()
export class StopHookService {
  constructor(
    private readonly grafana: GrafanaService,
    private readonly cfg: StopHookConfig,
  ) {}

  async evaluate(input: EvaluateInput): Promise<StopDecision> {
    const { rca, run, window } = input;
    const hours = hoursBetween(window.from, window.to);
    if (hours >= this.cfg.windowMaxHours) return { stop: true, reason: 'time_capped' };

    const meaningful =
      rca.root_cause.confidence >= this.cfg.confidenceThreshold && rca.evidence.length > 0;

    if (run.trigger !== 'webhook') {
      return meaningful
        ? { stop: true, reason: 'success' }
        : { stop: false, reason: 'not_meaningful_yet' };
    }

    if (!meaningful) return { stop: false, reason: 'not_meaningful_yet' };

    let alertOk = true;
    let metricBack = true;

    if (run.alert_uid) {
      try {
        const state = await this.grafana.getAlertState(run.alert_uid);
        alertOk = state === 'ok' || state === 'normal' || state === 'inactive';
      } catch {
        alertOk = false;
      }
    }

    if (run.alert_query && alertOk) {
      try {
        const promRes = await this.grafana.queryProm({
          promql: run.alert_query,
          from: shiftMinutes(window.to, -40),
          to: window.to,
          step: '60s',
          maxPoints: 200,
        });
        const points = promRes.points;
        const last5 = points.slice(-5).map(([_, v]) => v);
        const baseline = points.slice(0, -5).map(([_, v]) => v);
        const peak = points.reduce((p, [, v]) => Math.max(p, v), 0);
        const currentAvg = avg(last5);
        const baselineAvg = avg(baseline);
        const r = detectMetricBackToBaseline({
          baselineAvg,
          currentAvg,
          peak,
          tolerance: this.cfg.baselineTolerance,
        });
        metricBack = r.metricBack;
      } catch {
        metricBack = false;
      }
    }

    const spikeOver = alertOk && metricBack;
    if (spikeOver) return { stop: true, reason: 'success' };
    return { stop: false, reason: 'rca_good_but_incident_ongoing', details: { alertOk, metricBack } };
  }
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}
function shiftMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
```

- [ ] **Step 4: Write `apps/api/src/stop-hook/stop-hook.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { GrafanaModule } from '../grafana/grafana.module';
import { GrafanaService } from '../grafana/grafana.service';
import { ConfigService } from '../config/config.service';
import { StopHookService } from './stop-hook.service';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: StopHookService,
      inject: [GrafanaService, ConfigService],
      useFactory: (g: GrafanaService, c: ConfigService) =>
        new StopHookService(g, {
          confidenceThreshold: c.env.RCA_CONFIDENCE_THRESHOLD,
          baselineTolerance: c.env.BASELINE_TOLERANCE,
          windowMaxHours: c.env.WINDOW_MAX_HOURS,
        }),
    },
  ],
  exports: [StopHookService],
})
export class StopHookModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/stop-hook/ apps/api/test/stop-hook.test.ts
git commit -m "feat(api): StopHookService implementing spec §4.2 truth table"
```

### Task 9.4: Slack notifier

**Files:**
- Create: `apps/api/src/slack/slack.service.ts`
- Create: `apps/api/src/slack/slack.module.ts`
- Test: `apps/api/test/slack.service.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/slack.service.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import nock from 'nock';
import { SlackService } from '../src/slack/slack.service';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';

afterEach(() => nock.cleanAll());
const sink = { recordFailure: async () => {}, recordSuccess: async () => {} };

describe('SlackService.postRca', () => {
  it('POSTs JSON to the configured webhook url', async () => {
    const scope = nock('https://hooks').post('/services/AAA').reply(200, 'ok');
    const svc = new SlackService('https://hooks/services/AAA', new OutboundCallGuard(sink));
    await svc.postRca({
      rca: {
        summary: 'Postgres pool exhausted',
        root_cause: { component: 'postgres-primary', description: 'd', confidence: 0.9 },
        contributing_factors: [],
        timeline: [],
        evidence: [],
        suggested_next_steps: [],
        similar_past_rcas: [],
      },
      runId: 'r1',
      window: { from: 'a', to: 'b' },
      dashboardUrl: 'http://localhost:3000/rcas/r1',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('does not throw on 4xx (slack failures must never block RCA completion)', async () => {
    nock('https://hooks').post('/services/AAA').reply(404, 'no');
    const svc = new SlackService('https://hooks/services/AAA', new OutboundCallGuard(sink));
    await expect(svc.postRca({
      rca: {
        summary: 's',
        root_cause: { component: 'c', description: 'd', confidence: 0.5 },
        contributing_factors: [], timeline: [], evidence: [], suggested_next_steps: [], similar_past_rcas: [],
      },
      runId: 'r1', window: { from: 'a', to: 'b' }, dashboardUrl: '',
    })).resolves.toBeUndefined();
  });

  it('is a no-op when webhook url is empty', async () => {
    const svc = new SlackService('', new OutboundCallGuard(sink));
    await expect(svc.postRca({
      rca: {
        summary: 's',
        root_cause: { component: 'c', description: 'd', confidence: 0.5 },
        contributing_factors: [], timeline: [], evidence: [], suggested_next_steps: [], similar_past_rcas: [],
      },
      runId: 'r1', window: { from: 'a', to: 'b' }, dashboardUrl: '',
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/slack/slack.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import type { RcaOutput } from '@rca/agent';
import { OutboundCallGuard } from '../guard/outbound-call-guard';

export interface PostRcaInput {
  rca: RcaOutput;
  runId: string;
  window: { from: string; to: string };
  dashboardUrl: string;
}

@Injectable()
export class SlackService {
  constructor(
    private readonly webhookUrl: string,
    private readonly guard: OutboundCallGuard,
  ) {}

  async postRca(input: PostRcaInput): Promise<void> {
    if (!this.webhookUrl) return;
    const blocks = formatBlocks(input);
    try {
      await this.guard.withGuard(
        { target: 'slack', operation: 'post_rca', retries: 3 },
        async () => {
          const res = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: input.rca.summary, blocks }),
          });
          if (res.status >= 500) throw new Error(`slack ${res.status}`);
          if (res.status >= 400) return;
        },
      );
    } catch {
      // never block RCA completion — guard already records the event
    }
  }
}

function formatBlocks(input: PostRcaInput) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `RCA: ${input.rca.root_cause.component}`, emoji: false },
    },
    { type: 'section', text: { type: 'mrkdwn', text: input.rca.summary } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Window:* ${input.window.from} → ${input.window.to}` },
        { type: 'mrkdwn', text: `*Confidence:* ${input.rca.root_cause.confidence}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `<${input.dashboardUrl}|Open in dashboard>` },
    },
  ];
}
```

- [ ] **Step 4: Write `apps/api/src/slack/slack.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { GrafanaModule } from '../grafana/grafana.module';
import { OutboundCallGuard } from '../guard/outbound-call-guard';
import { SlackService } from './slack.service';

@Module({
  imports: [GrafanaModule],
  providers: [
    {
      provide: SlackService,
      inject: [ConfigService, OutboundCallGuard],
      useFactory: (c: ConfigService, g: OutboundCallGuard) =>
        new SlackService(c.env.SLACK_WEBHOOK_URL ?? '', g),
    },
  ],
  exports: [SlackService],
})
export class SlackModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/slack/ apps/api/test/slack.service.test.ts
git commit -m "feat(api): SlackService for RCA notifications (never blocks)"
```

### Task 9.5: Expand-window loop driver

Implements spec §4.1.

**Files:**
- Create: `apps/api/src/expand-loop/expand-loop.service.ts`
- Create: `apps/api/src/expand-loop/expand-loop.module.ts`
- Test: `apps/api/test/expand-loop.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/expand-loop.test.ts`:
```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { ExpandLoopService } from '../src/expand-loop/expand-loop.service';
import { StubClaudeClient } from '@rca/agent';
import { CoordinatorService } from '../src/coordinator/coordinator.service';
import { SubagentRunner } from '../src/coordinator/subagent-runner';
import { Prefetcher } from '../src/coordinator/prefetcher';
import { RunStreamBus } from '../src/coordinator/stream';
import { DependencyBus } from '../src/coordinator/dependency-bus';
import { SynthesizerService } from '../src/synthesizer/synthesizer.service';
import { StopHookService } from '../src/stop-hook/stop-hook.service';
import { PastRcaLookup } from '../src/synthesizer/past-rca-lookup';
import { SlackService } from '../src/slack/slack.service';
import { RunsRepo } from '../src/mongo/runs.repo';
import { RcasRepo } from '../src/mongo/rcas.repo';
import { ResolutionsRepo } from '../src/mongo/resolutions.repo';
import { OutboundCallGuard } from '../src/guard/outbound-call-guard';
import { EventsService } from '../src/events/events.service';
import { EventsRepo } from '../src/mongo/events.repo';

const sink = { recordFailure: async () => {}, recordSuccess: async () => {} };
const fakeGrafana = {
  queryLoki: vi.fn().mockResolvedValue({ lines: [], total_lines: 0 }),
  queryProm: vi.fn().mockResolvedValue({ points: [] }),
  queryCloudWatch: vi.fn(),
  getAlertState: vi.fn(),
} as any;

let mongod: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
});
beforeEach(async () => {
  await client.db('rca').dropDatabase();
});
afterAll(async () => {
  await client.close();
  await mongod.stop();
});

const components = [{ name: 'a', type: 'service' as const, description: 'A', loki: { selector: '{a}' } }];

function makeSubagent(status: any, confidence: number) {
  return new StubClaudeClient({
    'a-investigator': () => ({
      component: 'a', status, confidence, findings: [], suspected_dependencies: [], notes: '',
    }),
    synthesizer: () => ({
      summary: 's',
      root_cause: { component: 'a', description: 'd', confidence },
      contributing_factors: [], timeline: [],
      evidence: confidence >= 0.75 ? [{ component: 'a', type: 'log' as const, ref: 'r', excerpt: 'e' }] : [],
      suggested_next_steps: [], similar_past_rcas: [],
    }),
  });
}

function makeService(stub: StubClaudeClient) {
  const db = client.db('rca');
  const eventsRepo = new EventsRepo(db);
  const events = new EventsService(eventsRepo);
  const guard = new OutboundCallGuard(events);
  const coord = new CoordinatorService(
    new SubagentRunner(stub, { timeoutMs: 200 }),
    new Prefetcher(fakeGrafana, { concurrency: 4 }),
    new RunStreamBus(),
    new DependencyBus(),
  );
  const synth = new SynthesizerService(stub);
  const stop = new StopHookService(fakeGrafana, {
    confidenceThreshold: 0.75, baselineTolerance: 0.2, windowMaxHours: 24,
  });
  const past = new PastRcaLookup(new RcasRepo(db), new ResolutionsRepo(db));
  const slack = new SlackService('', guard);
  return new ExpandLoopService(
    coord, synth, stop, past, slack,
    new RunsRepo(db), new RcasRepo(db), new RunStreamBus(),
    { windowStepMinutes: 30, windowMaxHours: 24, backoffMs: 1, dashboardBaseUrl: 'http://x' },
  );
}

describe('ExpandLoopService.runCycle', () => {
  it('terminates after iteration 1 when manual run is confident + evidenced', async () => {
    const svc = makeService(makeSubagent('healthy', 0.9));
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components,
      promptMdByComponent: { a: 'prompt' },
      infraMd: 'infra',
      dependencyGraph: {},
      autoExpand: true,
    });
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe('success');
  });

  it('expands window backward by step when not meaningful', async () => {
    let calls = 0;
    const stub = new StubClaudeClient({
      'a-investigator': () => ({
        component: 'a', status: 'healthy', confidence: 0.9, findings: [], suspected_dependencies: [], notes: '',
      }),
      synthesizer: () => {
        calls++;
        return {
          summary: 's',
          root_cause: { component: 'a', description: 'd', confidence: calls < 3 ? 0.3 : 0.9 },
          contributing_factors: [], timeline: [],
          evidence: calls < 3 ? [] : [{ component: 'a', type: 'log' as const, ref: 'r', excerpt: 'e' }],
          suggested_next_steps: [], similar_past_rcas: [],
        };
      },
    });
    const svc = makeService(stub);
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components, promptMdByComponent: { a: 'prompt' }, infraMd: 'infra', dependencyGraph: {}, autoExpand: true,
    });
    expect(result.iterations).toBe(3);
  });

  it('respects autoExpand=false: returns after iteration 1 even when not meaningful', async () => {
    const svc = makeService(makeSubagent('inconclusive', 0.2));
    const result = await svc.runCycle({
      trigger: 'manual',
      window: { from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z' },
      components, promptMdByComponent: { a: 'prompt' }, infraMd: 'infra', dependencyGraph: {}, autoExpand: false,
    });
    expect(result.iterations).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/expand-loop/expand-loop.service.ts`**

Content:
```ts
import { Injectable } from '@nestjs/common';
import type { Component, RcaOutput } from '@rca/agent';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SynthesizerService } from '../synthesizer/synthesizer.service';
import { StopHookService, type StopDecision } from '../stop-hook/stop-hook.service';
import { PastRcaLookup } from '../synthesizer/past-rca-lookup';
import { SlackService } from '../slack/slack.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RcasRepo } from '../mongo/rcas.repo';
import { RunStreamBus } from '../coordinator/stream';

export interface RunCycleInput {
  trigger: 'manual' | 'webhook' | 'health';
  window: { from: string; to: string };
  components: Component[];
  promptMdByComponent: Record<string, string>;
  infraMd: string;
  dependencyGraph: Record<string, string[]>;
  autoExpand: boolean;
  alert_uid?: string;
  alert_query?: string;
}

export interface RunCycleResult {
  runId: string;
  rcaId?: string;
  rca: RcaOutput;
  iterations: number;
  stopReason: StopDecision['reason'];
  degraded: boolean;
}

export interface ExpandLoopConfig {
  windowStepMinutes: number;
  windowMaxHours: number;
  backoffMs: number;
  dashboardBaseUrl: string;
}

@Injectable()
export class ExpandLoopService {
  constructor(
    private readonly coord: CoordinatorService,
    private readonly synth: SynthesizerService,
    private readonly stop: StopHookService,
    private readonly past: PastRcaLookup,
    private readonly slack: SlackService,
    private readonly runs: RunsRepo,
    private readonly rcas: RcasRepo,
    private readonly bus: RunStreamBus,
    private readonly cfg: ExpandLoopConfig,
  ) {}

  async runCycle(input: RunCycleInput): Promise<RunCycleResult> {
    const runId = await this.runs.create({
      trigger: input.trigger,
      window: input.window,
      alert_uid: input.alert_uid,
      alert_query: input.alert_query,
    });

    let from = input.window.from;
    const to = input.window.to;
    let iteration = 0;
    let lastRca: RcaOutput | undefined;
    let degraded = false;
    let stopReason: StopDecision['reason'] = 'not_meaningful_yet';

    while (true) {
      iteration++;
      await this.runs.bumpIteration(runId, { from, to });

      const iter = await this.coord.runOneIteration({
        runId,
        components: input.components,
        promptMdByComponent: input.promptMdByComponent,
        window: { from, to },
      });

      if (!CoordinatorService.quorumMet(iter.outputs, input.components.length, 6)) {
        degraded = true;
        lastRca = degradedFallback();
        this.bus.publish(runId, { event: 'iteration_complete', data: { iteration, rca: lastRca, degraded: true } });
        break;
      }

      const suspects = unique([
        ...iter.outputs.map((o) => o.component),
        ...iter.outputs.flatMap((o) => o.suspected_dependencies),
      ]);
      const pastRcas = await this.past.fetch(suspects);

      const synth = await this.synth.synthesize({
        infraMd: input.infraMd,
        dependencyGraph: input.dependencyGraph,
        subagentOutputs: iter.outputs,
        pastRcas,
        window: { from, to },
      });
      lastRca = synth.rca;
      if (synth.degraded) degraded = true;

      const decision = await this.stop.evaluate({
        rca: synth.rca,
        run: { trigger: input.trigger, alert_uid: input.alert_uid, alert_query: input.alert_query },
        window: { from, to },
      });
      this.bus.publish(runId, {
        event: 'iteration_complete',
        data: { iteration, rca: synth.rca, stop_decision: decision },
      });

      if (decision.stop || !input.autoExpand) {
        stopReason = decision.stop ? decision.reason : 'not_meaningful_yet';
        break;
      }

      from = new Date(new Date(from).getTime() - this.cfg.windowStepMinutes * 60_000).toISOString();
      if (hoursBetween(from, to) > this.cfg.windowMaxHours) {
        stopReason = 'time_capped';
        break;
      }
      await new Promise((r) => setTimeout(r, this.cfg.backoffMs));
    }

    let rcaId: string | undefined;
    if (lastRca) {
      try {
        rcaId = await this.rcas.create({ runId, window: { from, to }, rca: lastRca });
      } catch {
        degraded = true;
      }
    }
    await this.runs.finalize(runId, degraded ? 'degraded' : 'completed', stopReason, rcaId);
    this.bus.publish(runId, { event: 'run_complete', data: { rcaId, rca: lastRca, reason: stopReason } });
    this.bus.endRun(runId);

    if (rcaId && lastRca) {
      await this.slack.postRca({
        rca: lastRca,
        runId,
        window: { from, to },
        dashboardUrl: `${this.cfg.dashboardBaseUrl}/rcas/${rcaId}`,
      });
    }

    return { runId, rcaId, rca: lastRca ?? degradedFallback(), iterations: iteration, stopReason, degraded };
  }
}

function hoursBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function degradedFallback(): RcaOutput {
  return {
    summary: 'RCA degraded — quorum not met or synthesizer failed',
    root_cause: { component: 'unknown', description: 'insufficient signal', confidence: 0 },
    contributing_factors: [],
    timeline: [],
    evidence: [],
    suggested_next_steps: ['re-run with a wider window', 'check the events panel for upstream failures'],
    similar_past_rcas: [],
  };
}
```

- [ ] **Step 4: Write `apps/api/src/expand-loop/expand-loop.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { SynthesizerModule } from '../synthesizer/synthesizer.module';
import { StopHookModule } from '../stop-hook/stop-hook.module';
import { SlackModule } from '../slack/slack.module';
import { MongoService } from '../mongo/mongo.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RcasRepo } from '../mongo/rcas.repo';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SynthesizerService } from '../synthesizer/synthesizer.service';
import { StopHookService } from '../stop-hook/stop-hook.service';
import { PastRcaLookup } from '../synthesizer/past-rca-lookup';
import { SlackService } from '../slack/slack.service';
import { RunStreamBus } from '../coordinator/stream';
import { ExpandLoopService } from './expand-loop.service';

@Module({
  imports: [CoordinatorModule, SynthesizerModule, StopHookModule, SlackModule],
  providers: [
    { provide: RunsRepo, inject: [MongoService], useFactory: (m: MongoService) => new RunsRepo(m.db()) },
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    {
      provide: ExpandLoopService,
      inject: [
        CoordinatorService,
        SynthesizerService,
        StopHookService,
        PastRcaLookup,
        SlackService,
        RunsRepo,
        RcasRepo,
        RunStreamBus,
        ConfigService,
      ],
      useFactory: (...args: any[]) => {
        const [coord, synth, stop, past, slack, runs, rcas, bus, c] = args;
        return new ExpandLoopService(coord, synth, stop, past, slack, runs, rcas, bus, {
          windowStepMinutes: (c as ConfigService).env.WINDOW_STEP_MINUTES,
          windowMaxHours: (c as ConfigService).env.WINDOW_MAX_HOURS,
          backoffMs: (c as ConfigService).env.BACKOFF_MS,
          dashboardBaseUrl: 'http://localhost:3000',
        });
      },
    },
  ],
  exports: [ExpandLoopService],
})
export class ExpandLoopModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/expand-loop/ apps/api/test/expand-loop.test.ts
git commit -m "feat(api): expand-window loop driver with quorum + slack on finalize"
```

---

## Phase 10 — HTTP controllers (POST /api/rca, GET /api/rcas, PATCH resolution, GET stream)

### Task 10.1: RCA controller (manual entry point)

**Files:**
- Create: `apps/api/src/rca/rca.controller.ts`
- Create: `apps/api/src/rca/rca.module.ts`
- Test: `apps/api/test/rca.controller.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/rca.controller.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RcaController } from '../src/rca/rca.controller';

describe('RcaController.create', () => {
  it('validates from/to and delegates to ExpandLoopService', async () => {
    const fake = {
      runCycle: async (input: any) => ({ runId: 'r1', rcaId: 'a1', rca: { summary: 's' }, iterations: 1, stopReason: 'success', degraded: false }),
    };
    const infra = {
      getComponents: () => [{ name: 'a' }],
      getProse: () => 'prose',
      getDependencyGraph: () => ({}),
    };
    const promptRead = { read: (name: string) => `prompt-for-${name}` };
    const ctrl = new RcaController(fake as any, infra as any, promptRead as any);
    const r = await ctrl.create({
      from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z', autoExpand: false,
    });
    expect(r.runId).toBe('r1');
    expect(r.rcaId).toBe('a1');
  });

  it('rejects when from > to', async () => {
    const ctrl = new RcaController(null as any, null as any, null as any);
    await expect(
      ctrl.create({ from: '2026-05-22T00:00:00Z', to: '2026-05-21T00:00:00Z', autoExpand: false }),
    ).rejects.toThrow();
  });
});

describe('RcaController.list', () => {
  it('returns recent rcas from the repo', async () => {
    const ctrl = new RcaController(null as any, null as any, null as any, { list: async () => [{ _id: 'x' }] } as any);
    const r = await ctrl.list();
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/rca/rca.controller.ts`**

Content:
```ts
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
```

- [ ] **Step 4: Write `apps/api/src/rca/rca.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { InfraModule } from '../infra/infra.module';
import { MongoService } from '../mongo/mongo.service';
import { RcasRepo } from '../mongo/rcas.repo';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { FsPromptReader, RcaController } from './rca.controller';

@Module({
  imports: [ExpandLoopModule, InfraModule],
  controllers: [RcaController],
  providers: [
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
    {
      provide: RcaController,
      inject: [ExpandLoopService, InfraLoaderService, RcasRepo],
      useFactory: (loop, infra, rcas) =>
        new RcaController(loop, infra, new FsPromptReader('/app/infra/prompts'), rcas),
    },
  ],
})
export class RcaModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/rca/ apps/api/test/rca.controller.test.ts
git commit -m "feat(api): RcaController POST /api/rca, list/get/resolve"
```

### Task 10.2: Runs SSE controller

Implements §4.6.

**Files:**
- Create: `apps/api/src/runs/runs.controller.ts`
- Create: `apps/api/src/runs/runs.module.ts`
- Test: `apps/api/test/runs.sse.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/runs.sse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RunStreamBus } from '../src/coordinator/stream';
import { formatSse } from '../src/runs/runs.controller';

describe('formatSse', () => {
  it('produces the documented SSE wire format', () => {
    const out = formatSse({ event: 'iteration_start', data: { iteration: 1 } });
    expect(out).toBe(`event: iteration_start\ndata: ${JSON.stringify({ iteration: 1 })}\n\n`);
  });
});

describe('RunStreamBus integration with formatter', () => {
  it('formats replayed + live messages', async () => {
    const bus = new RunStreamBus();
    bus.publish('r1', { event: 'a', data: { x: 1 } });
    const lines: string[] = [];
    bus.subscribe('r1', (msg) => lines.push(formatSse(msg)));
    bus.publish('r1', { event: 'b', data: { y: 2 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(lines.join('')).toContain('event: a');
    expect(lines.join('')).toContain('event: b');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/runs/runs.controller.ts`**

Content:
```ts
import { Controller, Get, Param, Res, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Response } from 'express';
import { RunStreamBus, type RunMessage } from '../coordinator/stream';
import { RunsRepo } from '../mongo/runs.repo';

export function formatSse(m: RunMessage): string {
  return `event: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`;
}

@Controller('api/runs')
export class RunsController {
  constructor(
    private readonly bus: RunStreamBus,
    private readonly runs: RunsRepo,
  ) {}

  @Get(':id')
  async one(@Param('id') id: string) {
    return this.runs.findById(id);
  }

  @Sse(':id/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsub = this.bus.subscribe(id, (m) => {
        subscriber.next({ type: m.event, data: m.data });
      });
      return () => unsub();
    });
  }
}
```

- [ ] **Step 4: Write `apps/api/src/runs/runs.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { MongoService } from '../mongo/mongo.service';
import { RunsRepo } from '../mongo/runs.repo';
import { RunsController } from './runs.controller';

@Module({
  imports: [CoordinatorModule],
  controllers: [RunsController],
  providers: [
    { provide: RunsRepo, inject: [MongoService], useFactory: (m: MongoService) => new RunsRepo(m.db()) },
  ],
})
export class RunsModule {}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 6: Register modules in AppModule**

Edit `apps/api/src/app.module.ts` — add to `imports`:
```ts
MongoModule, EventsModule, GrafanaModule, ExpandLoopModule, RcaModule, RunsModule
```

Resulting imports list:
```ts
imports: [
  ConfigModule,
  LoggerModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (c: ConfigService) => pinoOptions(c.env.LOG_LEVEL),
  }),
  InfraModule,
  MongoModule,
  EventsModule,
  GrafanaModule,
  ExpandLoopModule,
  RcaModule,
  RunsModule,
  HealthModule,
],
```

Add the corresponding imports at the top of the file.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/runs/ apps/api/src/app.module.ts apps/api/test/runs.sse.test.ts
git commit -m "feat(api): RunsController SSE + wire format helper"
```

---

## Phase 11 — CLI (nest-commander)

Implements spec §1.5 entry point 2: `rca analyze`, `rca health`, `rca resolve`, `rca validate-infra`.

### Task 11.1: CLI module + commands

**Files:**
- Create: `apps/api/src/cli/cli.module.ts`
- Create: `apps/api/src/cli/analyze.command.ts`
- Create: `apps/api/src/cli/health.command.ts`
- Create: `apps/api/src/cli/resolve.command.ts`
- Test: `apps/api/test/cli.test.ts`

- [ ] **Step 1: Write failing test for parsers/handlers (no NestJS bootstrap)**

File `apps/api/test/cli.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { analyzeHandler } from '../src/cli/analyze.command';

describe('analyzeHandler', () => {
  it('runs an RCA and prints the rcaId', async () => {
    const loop = { runCycle: vi.fn().mockResolvedValue({ runId: 'r1', rcaId: 'a1', iterations: 2, stopReason: 'success' }) };
    const infra = { getComponents: () => [{ name: 'x' }], getProse: () => 'p', getDependencyGraph: () => ({}) };
    const reader = { read: (n: string) => `prompt:${n}` };
    const log = vi.fn();
    await analyzeHandler({
      from: '2026-05-21T20:00:00Z', to: '2026-05-22T00:00:00Z', autoExpand: false,
    }, { loop: loop as any, infra: infra as any, prompts: reader as any, log });
    expect(loop.runCycle).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('a1'));
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/cli/analyze.command.ts`**

Content:
```ts
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
```

- [ ] **Step 4: Write `apps/api/src/cli/health.command.ts`**

Content:
```ts
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
```

- [ ] **Step 5: Write `apps/api/src/cli/resolve.command.ts`**

Content:
```ts
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
```

- [ ] **Step 6: Write `apps/api/src/cli/cli.module.ts`**

Content:
```ts
import { CommandFactory } from 'nest-commander';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { MongoModule } from '../mongo/mongo.module';
import { InfraModule } from '../infra/infra.module';
import { GrafanaModule } from '../grafana/grafana.module';
import { EventsModule } from '../events/events.module';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { AnalyzeCommand } from './analyze.command';
import { HealthCommand } from './health.command';
import { ResolveCommand } from './resolve.command';
import { RcasRepo } from '../mongo/rcas.repo';
import { MongoService } from '../mongo/mongo.service';

@Module({
  imports: [ConfigModule, MongoModule, InfraModule, EventsModule, GrafanaModule, ExpandLoopModule],
  providers: [
    AnalyzeCommand,
    HealthCommand,
    ResolveCommand,
    { provide: RcasRepo, inject: [MongoService], useFactory: (m: MongoService) => new RcasRepo(m.db()) },
  ],
})
export class CliModule {}

if (process.argv[1]?.endsWith('cli.module.ts') || process.argv[1]?.endsWith('cli.module.js')) {
  CommandFactory.run(CliModule, { logger: ['error'] }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 7: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/cli/ apps/api/test/cli.test.ts
git commit -m "feat(api): nest-commander CLI - analyze, health, resolve"
```

---

## Phase 12 — Next.js dashboard

Implements spec §1.5 entry point 1 + §5.11 notification center + §4.6 streamed iteration view. Thin client — it just renders what the API streams.

The web app uses `process.env.NEXT_PUBLIC_API_URL` (default `http://localhost:8080`) so the same image works in dev and in Docker (where it's set to `http://rca-api:8080` via compose).

### Task 12.1: Next.js scaffold + Tailwind

**Files:**
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/next-env.d.ts`

- [ ] **Step 1: Add deps**

Run: `pnpm --filter @rca/web add next@15.0.3 react@18.3.1 react-dom@18.3.1 && pnpm --filter @rca/web add -D @types/react@18.3.12 @types/react-dom@18.3.1 tailwindcss@3.4.14 postcss@8.4.49 autoprefixer@10.4.20`
Expected: installed.

- [ ] **Step 2: Write `apps/web/next.config.mjs`**

Content:
```js
const config = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}/api/:path*` },
    ];
  },
};
export default config;
```

- [ ] **Step 3: Write `apps/web/postcss.config.js`**

Content:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: Write `apps/web/tailwind.config.ts`**

Content:
```ts
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: Write `apps/web/app/globals.css`**

Content:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { @apply bg-neutral-50 text-neutral-900; }
```

- [ ] **Step 6: Write `apps/web/app/layout.tsx`**

Content:
```tsx
import './globals.css';
import { NotificationBell } from '../components/NotificationBell';

export const metadata = { title: 'rca-claude-code' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b bg-white px-6 py-3 flex items-center justify-between">
          <nav className="flex gap-6 text-sm">
            <a href="/analyze" className="font-medium">Analyze</a>
            <a href="/rcas">RCAs</a>
            <a href="/events">Events</a>
            <a href="/health">Health</a>
          </nav>
          <NotificationBell />
        </header>
        <main className="px-6 py-6 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Write `apps/web/app/page.tsx`**

Content:
```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/analyze'); }
```

- [ ] **Step 8: Write `apps/web/next-env.d.ts`**

Content:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 9: Verify build**

Run: `pnpm --filter @rca/web build`
Expected: builds successfully (no pages will render since `/analyze` doesn't exist yet — `build` should still succeed because the redirect doesn't need the target to exist at build time). If build fails on missing components, finish Task 12.2 first.

- [ ] **Step 10: Commit**

```bash
git add apps/web/ pnpm-lock.yaml
git commit -m "feat(web): Next.js scaffold + Tailwind + root layout"
```

### Task 12.2: NotificationBell + EventDrawer

Implements §5.11.

**Files:**
- Create: `apps/web/components/NotificationBell.tsx`
- Create: `apps/web/components/EventDrawer.tsx`

- [ ] **Step 1: Write `apps/web/components/NotificationBell.tsx`**

Content:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { EventDrawer } from './EventDrawer';

interface Counts { critical: number; error: number; warn: number }

export function NotificationBell() {
  const [counts, setCounts] = useState<Counts>({ critical: 0, error: 0, warn: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const res = await fetch('/api/healthz');
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setCounts(j.unacknowledged_events ?? { critical: 0, error: 0, warn: 0 });
      } catch {}
    }
    fetchCounts();
    const id = setInterval(fetchCounts, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = counts.critical + counts.error + counts.warn;
  const color = counts.critical > 0 ? 'bg-red-600' : counts.error > 0 ? 'bg-orange-500' : counts.warn > 0 ? 'bg-yellow-500' : 'bg-neutral-400';

  return (
    <>
      <button onClick={() => setOpen((v) => !v)} className="relative p-1" aria-label="Notifications">
        <span className="text-lg">🔔</span>
        {total > 0 && (
          <span className={`absolute -top-1 -right-1 text-[10px] text-white rounded-full px-1 ${color}`}>{total}</span>
        )}
      </button>
      {open && <EventDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Write `apps/web/components/EventDrawer.tsx`**

Content:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface EventRow {
  _id: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  source: string;
  operation: string;
  message: string;
  created_at: string;
  suggested_fix?: string | null;
}

const sevColor: Record<string, string> = {
  critical: 'text-red-700',
  error: 'text-orange-600',
  warn: 'text-yellow-600',
  info: 'text-neutral-500',
};

export function EventDrawer({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => {
    fetch('/api/events/unacknowledged').then((r) => r.json()).then(setRows).catch(() => {});
  }, []);

  async function ignore(id: string) {
    await fetch(`/api/events/${id}/ignore`, { method: 'PATCH' });
    setRows((r) => r.filter((x) => x._id !== id));
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l shadow-lg p-4 overflow-y-auto z-50">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Unacknowledged events</h2>
        <button onClick={onClose} className="text-sm">✕</button>
      </div>
      {rows.length === 0 && <p className="text-sm text-neutral-500">All clear.</p>}
      <ul className="space-y-3">
        {rows.map((e) => (
          <li key={e._id} className="border rounded p-2 text-sm">
            <div className={`font-medium ${sevColor[e.severity]}`}>{e.severity} · {e.source}.{e.operation}</div>
            <div className="text-neutral-700">{e.message}</div>
            {e.suggested_fix && <div className="text-xs text-neutral-500 mt-1">Fix: {e.suggested_fix}</div>}
            <div className="flex gap-2 mt-2">
              <a href={`/events/${e._id}`} className="text-xs underline">View</a>
              <button onClick={() => ignore(e._id)} className="text-xs underline">Ignore</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/NotificationBell.tsx apps/web/components/EventDrawer.tsx
git commit -m "feat(web): NotificationBell + EventDrawer (persistent events panel)"
```

### Task 12.3: Analyze form + live run stream view

**Files:**
- Create: `apps/web/components/AnalyzeForm.tsx`
- Create: `apps/web/components/RunStream.tsx`
- Create: `apps/web/app/analyze/page.tsx`
- Create: `apps/web/app/runs/[id]/page.tsx`

- [ ] **Step 1: Write `apps/web/components/AnalyzeForm.tsx`**

Content:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function isoNowMinusHours(h: number): string {
  const d = new Date(Date.now() - h * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function AnalyzeForm() {
  const router = useRouter();
  const [from, setFrom] = useState(isoNowMinusHours(4));
  const [to, setTo] = useState(isoNowMinusHours(0));
  const [autoExpand, setAutoExpand] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/rca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          autoExpand,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      router.push(`/runs/${j.runId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <div>
        <label className="block text-sm font-medium">From</label>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded p-1 w-full" required />
      </div>
      <div>
        <label className="block text-sm font-medium">To</label>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded p-1 w-full" required />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoExpand} onChange={(e) => setAutoExpand(e.target.checked)} />
        Auto-expand window if first pass is not conclusive
      </label>
      <button type="submit" disabled={submitting} className="bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50">
        {submitting ? 'Running…' : 'Run RCA'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Write `apps/web/components/RunStream.tsx`**

Content:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface IterationCard {
  iteration: number;
  rca?: any;
  stop_decision?: { stop: boolean; reason: string };
  subagentDone: { component: string; output: any }[];
}

export function RunStream({ runId }: { runId: string }) {
  const [iterations, setIterations] = useState<IterationCard[]>([]);
  const [done, setDone] = useState(false);
  const [finalRca, setFinalRca] = useState<any>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.addEventListener('iteration_start', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setIterations((it) => [...it, { iteration: it.length + 1, subagentDone: [] }]);
    });
    es.addEventListener('subagent_done', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setIterations((it) => {
        const cur = it[it.length - 1];
        if (!cur) return it;
        return [...it.slice(0, -1), { ...cur, subagentDone: [...cur.subagentDone, d] }];
      });
    });
    es.addEventListener('iteration_complete', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setIterations((it) => {
        const cur = it[it.length - 1];
        if (!cur) return it;
        return [...it.slice(0, -1), { ...cur, rca: d.rca, stop_decision: d.stop_decision }];
      });
    });
    es.addEventListener('run_complete', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setDone(true);
      setFinalRca(d.rca);
    });
    return () => es.close();
  }, [runId]);

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Run {runId}</h2>
      {iterations.map((it) => (
        <details key={it.iteration} open className="border rounded p-3">
          <summary className="font-medium cursor-pointer">
            Iteration {it.iteration} {it.stop_decision && `· ${it.stop_decision.reason}`}
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            {it.subagentDone.map((s) => (
              <div key={s.component} className="border rounded p-2">
                <div className="font-medium">{s.component}</div>
                <div>status: {s.output.status}</div>
                <div>confidence: {s.output.confidence}</div>
              </div>
            ))}
          </div>
          {it.rca && (
            <div className="mt-3 text-sm">
              <div className="font-medium">{it.rca.summary}</div>
              <div className="text-neutral-600">
                Root cause: {it.rca.root_cause.component} ({it.rca.root_cause.confidence})
              </div>
            </div>
          )}
        </details>
      ))}
      {done && finalRca && (
        <div className="bg-green-50 border rounded p-4">
          <h3 className="font-medium">Run complete</h3>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(finalRca, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/app/analyze/page.tsx`**

Content:
```tsx
import { AnalyzeForm } from '../../components/AnalyzeForm';
export default function AnalyzePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Run RCA</h1>
      <AnalyzeForm />
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/web/app/runs/[id]/page.tsx`**

Content:
```tsx
import { RunStream } from '../../../components/RunStream';
export default function RunPage({ params }: { params: { id: string } }) {
  return <RunStream runId={params.id} />;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/AnalyzeForm.tsx apps/web/components/RunStream.tsx apps/web/app/analyze apps/web/app/runs
git commit -m "feat(web): analyze form + live run stream view"
```

### Task 12.4: RCAs list, detail, resolution

**Files:**
- Create: `apps/web/components/RcaList.tsx`
- Create: `apps/web/components/RcaDetail.tsx`
- Create: `apps/web/app/rcas/page.tsx`
- Create: `apps/web/app/rcas/[id]/page.tsx`
- Create: `apps/web/app/rcas/[id]/resolution/page.tsx`

- [ ] **Step 1: Write `apps/web/components/RcaList.tsx`**

Content:
```tsx
'use client';
import { useEffect, useState } from 'react';

export function RcaList() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/rcas').then((r) => r.json()).then(setRows);
  }, []);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r._id} className="border rounded p-3">
          <a href={`/rcas/${r._id}`} className="font-medium underline">{r.rca.summary || '(no summary)'}</a>
          <div className="text-xs text-neutral-500">
            {r.rca.root_cause.component} · confidence {r.rca.root_cause.confidence} · status {r.status}
          </div>
        </li>
      ))}
      {rows.length === 0 && <p className="text-sm text-neutral-500">No RCAs yet.</p>}
    </ul>
  );
}
```

- [ ] **Step 2: Write `apps/web/components/RcaDetail.tsx`**

Content:
```tsx
'use client';
import { useEffect, useState } from 'react';

export function RcaDetail({ id }: { id: string }) {
  const [doc, setDoc] = useState<any>(null);
  useEffect(() => { fetch(`/api/rcas/${id}`).then((r) => r.json()).then(setDoc); }, [id]);
  if (!doc) return <p>Loading…</p>;
  const rca = doc.rca;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{rca.summary}</h1>
      <div className="text-sm text-neutral-700">Status: {doc.status}</div>
      <section>
        <h2 className="font-medium">Root cause</h2>
        <p>{rca.root_cause.component} — {rca.root_cause.description} (confidence {rca.root_cause.confidence})</p>
      </section>
      <section>
        <h2 className="font-medium">Timeline</h2>
        <ul className="text-sm">{rca.timeline.map((t: any, i: number) => <li key={i}><strong>{t.ts}:</strong> {t.event}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-medium">Evidence</h2>
        <ul className="text-sm">
          {rca.evidence.map((e: any, i: number) => (
            <li key={i}><strong>{e.component}</strong> {e.type} — {e.excerpt}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">Next steps</h2>
        <ul className="text-sm list-disc pl-6">{rca.suggested_next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
      </section>
      <a href={`/rcas/${id}/resolution`} className="inline-block bg-neutral-900 text-white px-3 py-1.5 rounded">
        Record resolution
      </a>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/app/rcas/page.tsx`**

Content:
```tsx
import { RcaList } from '../../components/RcaList';
export default function RcasPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">RCAs</h1>
      <RcaList />
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/web/app/rcas/[id]/page.tsx`**

Content:
```tsx
import { RcaDetail } from '../../../components/RcaDetail';
export default function RcaPage({ params }: { params: { id: string } }) {
  return <RcaDetail id={params.id} />;
}
```

- [ ] **Step 5: Write `apps/web/app/rcas/[id]/resolution/page.tsx`**

Content:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResolutionPage({ params }: { params: { id: string } }) {
  const r = useRouter();
  const [note, setNote] = useState('');
  const [steps, setSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch(`/api/rcas/${params.id}/resolution`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', note, steps: steps.split('\n').filter(Boolean) }),
    });
    r.push(`/rcas/${params.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-md">
      <h1 className="text-lg font-semibold">Record resolution</h1>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did to fix it" className="border rounded p-2 w-full h-32" required />
      <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="One step per line (optional)" className="border rounded p-2 w-full h-32" />
      <button type="submit" disabled={submitting} className="bg-neutral-900 text-white rounded px-4 py-2">
        {submitting ? 'Saving…' : 'Save resolution'}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/RcaList.tsx apps/web/components/RcaDetail.tsx apps/web/app/rcas
git commit -m "feat(web): rcas list/detail/resolution pages"
```

### Task 12.5: Events page + Health grid

**Files:**
- Create: `apps/web/components/HealthGrid.tsx`
- Create: `apps/web/app/events/page.tsx`
- Create: `apps/web/app/events/[id]/page.tsx`
- Create: `apps/web/app/health/page.tsx`

- [ ] **Step 1: Write `apps/web/app/events/page.tsx`**

Content:
```tsx
'use client';
import { useEffect, useState } from 'react';
export default function EventsPage() {
  const [severity, setSeverity] = useState<string>('');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const qs = severity ? `?severity=${severity}` : '';
    fetch(`/api/events${qs}`).then((r) => r.json()).then(setRows);
  }, [severity]);
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Events</h1>
      <div className="mb-3">
        <label>Severity </label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="border p-1 rounded">
          <option value="">all</option>
          <option value="critical">critical</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
        </select>
      </div>
      <ul className="space-y-2">
        {rows.map((e) => (
          <li key={e._id} className="border rounded p-2 text-sm">
            <div><strong>{e.severity}</strong> · {e.source}.{e.operation} · {e.status}</div>
            <div className="text-neutral-700">{e.message}</div>
            <a href={`/events/${e._id}`} className="text-xs underline">Detail</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/app/events/[id]/page.tsx`**

Content:
```tsx
'use client';
import { useEffect, useState } from 'react';
export default function EventDetail({ params }: { params: { id: string } }) {
  const [doc, setDoc] = useState<any>(null);
  useEffect(() => { fetch(`/api/events/${params.id}`).then((r) => r.json()).then(setDoc); }, [params.id]);
  if (!doc) return <p>Loading…</p>;
  async function act(action: 'resolve' | 'ignore') {
    await fetch(`/api/events/${params.id}/${action}`, { method: 'PATCH' });
    setDoc({ ...doc, status: action === 'resolve' ? 'resolved' : 'ignored' });
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">{doc.severity} · {doc.source}.{doc.operation}</h1>
      <p>{doc.message}</p>
      {doc.suggested_fix && <p className="text-sm text-neutral-600">Suggested fix: {doc.suggested_fix}</p>}
      <pre className="text-xs bg-neutral-100 p-2 rounded">{JSON.stringify(doc.context ?? {}, null, 2)}</pre>
      <div className="flex gap-2">
        <button onClick={() => act('resolve')} className="bg-green-700 text-white rounded px-3 py-1">Mark resolved</button>
        <button onClick={() => act('ignore')} className="border rounded px-3 py-1">Ignore</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/components/HealthGrid.tsx`**

Content:
```tsx
'use client';
import { useEffect, useState } from 'react';
export function HealthGrid() {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    fetch('/api/healthz').then((r) => r.json()).then(setH);
  }, []);
  if (!h) return <p>Loading…</p>;
  const Cell = ({ name, ok }: { name: string; ok: boolean }) => (
    <div className={`border rounded p-3 ${ok ? 'bg-green-50' : 'bg-red-50'}`}>
      <div className="text-sm">{name}</div>
      <div className="font-medium">{ok ? 'OK' : 'DOWN'}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      <Cell name="Grafana" ok={h.grafana} />
      <Cell name="Mongo" ok={h.mongo} />
      <Cell name="Claude auth" ok={h.claude_auth} />
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/web/app/health/page.tsx`**

Content:
```tsx
import { HealthGrid } from '../../components/HealthGrid';
export default function HealthPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Health</h1>
      <HealthGrid />
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @rca/web build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/events apps/web/app/health apps/web/components/HealthGrid.tsx
git commit -m "feat(web): events list/detail + health grid pages"
```

---

## Phase 13 — Docker + docker-compose + .env.example

Implements spec §1.3 (Claude CLI auth via mounted `~/.claude`), §1.4 + §1.6.

### Task 13.1: API Dockerfile

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/api/.dockerignore`

- [ ] **Step 1: Write `apps/api/Dockerfile`**

Content:
```dockerfile
# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN npm i -g pnpm@9.12.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/agent/package.json apps/agent/tsconfig.json apps/agent/src apps/agent/src/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY apps/agent ./apps/agent
COPY apps/api ./apps/api

RUN pnpm --filter @rca/agent run build
RUN pnpm --filter @rca/api run build

# Runtime stage
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@9.12.0 @anthropic-ai/claude-code

ENV NODE_ENV=production
ENV CLAUDE_CONFIG_DIR=/root/.claude
ENV INFRA_MD_PATH=/app/infra/infra.md
ENV PORT=8080

COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/agent/dist ./node_modules/@rca/agent/dist
COPY --from=build /repo/apps/agent/package.json ./node_modules/@rca/agent/package.json
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --prod --frozen-lockfile

VOLUME ["/app/infra", "/root/.claude"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/readyz || exit 1

CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Write `apps/api/.dockerignore`**

Content:
```
node_modules
dist
test
coverage
.eslintrc.cjs
tsconfig.tsbuildinfo
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/Dockerfile apps/api/.dockerignore
git commit -m "feat(api): multi-stage Dockerfile with Claude CLI + healthcheck"
```

### Task 13.2: Web Dockerfile

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/.dockerignore`

- [ ] **Step 1: Write `apps/web/Dockerfile`**

Content:
```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN npm i -g pnpm@9.12.0
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --filter @rca/web --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@9.12.0
COPY --from=deps /repo/node_modules ./node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web ./apps/web
RUN pnpm --filter @rca/web build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000 || exit 1
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 2: Write `apps/web/.dockerignore`**

Content:
```
node_modules
.next
.next/cache
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/Dockerfile apps/web/.dockerignore
git commit -m "feat(web): standalone Next.js Dockerfile"
```

### Task 13.3: docker-compose.yml + .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `infra/infra.example.md`

- [ ] **Step 1: Write `docker-compose.yml`**

Content:
```yaml
services:
  rca-api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: rca-api
    restart: unless-stopped
    env_file: .env
    environment:
      INFRA_MD_PATH: /app/infra/infra.md
      CLAUDE_CONFIG_DIR: /root/.claude
      PORT: 8080
    volumes:
      - ./infra:/app/infra:ro
      - ${CLAUDE_CONFIG_DIR_HOST:-${HOME}/.claude}:/root/.claude:ro
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8080/readyz || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 5

  rca-ui:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: rca-ui
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_URL: http://rca-api:8080
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      rca-api:
        condition: service_healthy
```

- [ ] **Step 2: Write `.env.example`**

Content:
```bash
# Required
GRAFANA_URL=https://grafana.example.com
GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_xxxxx
MONGO_URI=mongodb://host.docker.internal:27017/rca

# Optional — auto-discovered from Grafana if unset
LOKI_DATASOURCE_UID=
PROM_DATASOURCE_UID=
CW_DATASOURCE_UID=

# Optional — Slack delivery
SLACK_WEBHOOK_URL=

# Optional — loop tuning
WINDOW_INITIAL_HOURS=4
WINDOW_STEP_MINUTES=30
WINDOW_MAX_HOURS=24
RCA_CONFIDENCE_THRESHOLD=0.75
BASELINE_TOLERANCE=0.20
BACKOFF_MS=5000
MAX_COMPONENTS=20

# Logging
LOG_LEVEL=info
LOG_SUCCESSES=false

# Host-side path to your Claude CLI config dir (mounted read-only into the api container)
# On most setups: ~/.claude
CLAUDE_CONFIG_DIR_HOST=${HOME}/.claude
```

- [ ] **Step 3: Write `infra/infra.example.md`** (canonical example anyone can copy to `infra.md`)

Content:
```markdown
# Infra overview

## Request flow
A typical user request hits the ALB → auth-service (validates JWT) → payments-api
(reads from postgres-primary, writes to redis-cache for session state) → emits an event to
RabbitMQ → consumed by notification-worker which sends to SES.

## Topology notes
- All services run on ECS Fargate in us-east-1
- Postgres primary has 2 read replicas
- Redis is a 3-node cluster

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs, issues session cookies, handles login/logout
loki:
  selector: '{service="auth-service", env="prod"}'
  error_filter: '|~ "(?i)error|fatal|panic|exception"'
prometheus:
  metrics:
    - name: request_rate
      query: 'sum(rate(http_requests_total{service="auth-service"}[5m]))'
    - name: error_rate
      query: 'sum(rate(http_requests_total{service="auth-service",status=~"5.."}[5m]))'
cloudwatch:
  namespace: AWS/ECS
  dimensions:
    ClusterName: prod
    ServiceName: auth-service
  metrics: [CPUUtilization, MemoryUtilization]
depends_on: [postgres-primary, redis-cache]
runbook_url: https://wiki.internal/runbooks/auth-service
```

## Component: postgres-primary

```yaml
name: postgres-primary
type: datastore
description: Primary Postgres for application state
prometheus:
  metrics:
    - name: active_connections
      query: 'pg_stat_activity_count{instance="postgres-primary"}'
    - name: replication_lag_seconds
      query: 'pg_replication_lag_seconds{instance="postgres-primary"}'
cloudwatch:
  namespace: AWS/RDS
  dimensions:
    DBInstanceIdentifier: postgres-primary
  metrics: [CPUUtilization, FreeableMemory, DatabaseConnections]
runbook_url: https://wiki.internal/runbooks/postgres
```

## Component: redis-cache

```yaml
name: redis-cache
type: cache
description: Session cache (3-node cluster)
cloudwatch:
  namespace: AWS/ElastiCache
  dimensions:
    CacheClusterId: redis-cache
  metrics: [CPUUtilization, FreeableMemory, CurrConnections, Evictions]
runbook_url: https://wiki.internal/runbooks/redis
```
```

- [ ] **Step 4: Verify compose syntax**

Run: `docker compose -f docker-compose.yml config > /dev/null`
Expected: prints nothing, exits 0. (Skip if docker daemon not running locally; CI will catch issues.)

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example infra/infra.example.md
git commit -m "feat: docker-compose + .env.example + canonical infra example"
```

---

## Phase 14 — Grafana webhook (lowest priority, built last per user)

Implements spec §1.5 entry point 4 + §4.3 (cache `alert_uid` on `runs`).

### Task 14.1: Webhook controller

**Files:**
- Create: `apps/api/src/webhook/webhook.controller.ts`
- Create: `apps/api/src/webhook/webhook.module.ts`
- Test: `apps/api/test/webhook.controller.test.ts`

- [ ] **Step 1: Write failing test**

File `apps/api/test/webhook.controller.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { WebhookController } from '../src/webhook/webhook.controller';

const samplePayload = {
  status: 'firing',
  alerts: [
    {
      labels: { __alert_rule_uid__: 'rule-1', alertname: 'high-latency' },
      annotations: { description: 'p95 over 2s' },
      startsAt: '2026-05-22T09:00:00Z',
      valueString: '[ var=A query=sum(rate(http_requests_total[5m])) value=42 ]',
    },
  ],
};

describe('WebhookController.receive', () => {
  it('parses alert payload, caches alert metadata, and triggers ExpandLoop with trigger=webhook', async () => {
    const loop = { runCycle: vi.fn().mockResolvedValue({ runId: 'r1' }) };
    const alerts = { cache: vi.fn().mockResolvedValue(undefined) };
    const infra = {
      getComponents: () => [{ name: 'x' }],
      getProse: () => 'prose',
      getDependencyGraph: () => ({}),
    };
    const prompts = { read: () => 'p' };
    const ctrl = new WebhookController(loop as any, alerts as any, infra as any, prompts as any);
    const r = await ctrl.receive(samplePayload as any);
    expect(loop.runCycle).toHaveBeenCalled();
    expect(loop.runCycle.mock.calls[0][0].trigger).toBe('webhook');
    expect(loop.runCycle.mock.calls[0][0].alert_uid).toBe('rule-1');
    expect(alerts.cache).toHaveBeenCalled();
    expect(r.runId).toBe('r1');
  });

  it('returns 200 and ignores resolved alerts', async () => {
    const loop = { runCycle: vi.fn() };
    const alerts = { cache: vi.fn() };
    const ctrl = new WebhookController(loop as any, alerts as any, null as any, null as any);
    const r = await ctrl.receive({ status: 'resolved', alerts: [] } as any);
    expect(loop.runCycle).not.toHaveBeenCalled();
    expect(r.ignored).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `pnpm --filter @rca/api test`
Expected: FAIL.

- [ ] **Step 3: Write `apps/api/src/webhook/webhook.controller.ts`**

Content:
```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { z } from 'zod';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { AlertsRepo } from '../mongo/alerts.repo';
import { InfraLoaderService } from '../infra/infra-loader.service';
import type { PromptReader } from '../rca/rca.controller';

const WebhookPayload = z.object({
  status: z.string(),
  alerts: z.array(
    z.object({
      labels: z.record(z.string(), z.string()).default({}),
      annotations: z.record(z.string(), z.string()).default({}),
      startsAt: z.string().optional(),
      valueString: z.string().optional(),
    }),
  ).default([]),
});

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly loop: ExpandLoopService,
    private readonly alerts: AlertsRepo,
    private readonly infra: InfraLoaderService,
    private readonly prompts: PromptReader,
  ) {}

  @Post('grafana')
  @HttpCode(HttpStatus.OK)
  async receive(@Body() body: unknown) {
    const parsed = WebhookPayload.safeParse(body);
    if (!parsed.success) return { ignored: true, error: 'bad payload' };
    if (parsed.data.status !== 'firing') return { ignored: true };

    const alert = parsed.data.alerts[0];
    if (!alert) return { ignored: true };

    const alertUid = alert.labels['__alert_rule_uid__'] ?? alert.labels['alertname'] ?? 'unknown';
    const query = extractQuery(alert.valueString ?? '');
    await this.alerts.cache(alertUid, alert as Record<string, unknown>, query);

    const startedAt = alert.startsAt ? new Date(alert.startsAt) : new Date();
    const to = new Date(Date.now()).toISOString();
    const from = new Date(startedAt.getTime() - 4 * 3_600_000).toISOString();

    const components = this.infra.getComponents();
    const promptMdByComponent: Record<string, string> = {};
    for (const c of components) promptMdByComponent[c.name] = this.prompts.read(c.name);

    return this.loop.runCycle({
      trigger: 'webhook',
      window: { from, to },
      components,
      promptMdByComponent,
      infraMd: this.infra.getProse(),
      dependencyGraph: this.infra.getDependencyGraph(),
      autoExpand: true,
      alert_uid: alertUid,
      alert_query: query,
    });
  }
}

function extractQuery(valueString: string): string {
  const m = valueString.match(/query=([^\s\]]+)/);
  return m ? m[1] : '';
}
```

- [ ] **Step 4: Write `apps/api/src/webhook/webhook.module.ts`**

Content:
```ts
import { Module } from '@nestjs/common';
import { ExpandLoopModule } from '../expand-loop/expand-loop.module';
import { InfraModule } from '../infra/infra.module';
import { MongoService } from '../mongo/mongo.service';
import { AlertsRepo } from '../mongo/alerts.repo';
import { ExpandLoopService } from '../expand-loop/expand-loop.service';
import { InfraLoaderService } from '../infra/infra-loader.service';
import { FsPromptReader } from '../rca/rca.controller';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [ExpandLoopModule, InfraModule],
  controllers: [WebhookController],
  providers: [
    { provide: AlertsRepo, inject: [MongoService], useFactory: (m: MongoService) => new AlertsRepo(m.db()) },
    {
      provide: WebhookController,
      inject: [ExpandLoopService, AlertsRepo, InfraLoaderService],
      useFactory: (loop, alerts, infra) =>
        new WebhookController(loop, alerts, infra, new FsPromptReader('/app/infra/prompts')),
    },
  ],
})
export class WebhookModule {}
```

- [ ] **Step 5: Register in AppModule**

Edit `apps/api/src/app.module.ts` — add `WebhookModule` to the imports list (right after `RunsModule`).

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @rca/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/webhook/ apps/api/src/app.module.ts apps/api/test/webhook.controller.test.ts
git commit -m "feat(api): grafana webhook controller (lowest-priority entry point)"
```

---

## Phase 15 — CI

Implements spec §6.9.

### Task 15.1: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

Content:
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: {}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  docker-build:
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build api image
        run: docker buildx build -f apps/api/Dockerfile -t rca-api:ci --load .
      - name: Build web image
        run: docker buildx build -f apps/web/Dockerfile -t rca-ui:ci --load .

  e2e:
    runs-on: ubuntu-latest
    needs: [test]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:e2e
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: github actions workflow (lint, typecheck, test, docker build, e2e on main)"
```

---

## Final sweep — README pointer + push

### Task FINAL.1: Add plan pointer to README + final push

**Files:**
- Modify: `README.md` (add a line under "How to continue this work" linking to this plan)

- [ ] **Step 1: Edit README**

Replace the line in `README.md` that says the design spec is the source of truth so it also lists the implementation plan:

Find the section that lists the design spec (around the "Design + plan" subheading) and add:
```
- Implementation plan: [docs/superpowers/specs/2026-05-22-rca-agent-implementation-plan.md](docs/superpowers/specs/2026-05-22-rca-agent-implementation-plan.md)
```

- [ ] **Step 2: Commit + push**

```bash
git add README.md
git commit -m "docs: link implementation plan from README"
git push origin main
```

- [ ] **Step 3: Smoke-test locally (manual)**

Run, in order:
1. `cp .env.example .env` — fill in `GRAFANA_URL`, `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `MONGO_URI`
2. `cp infra/infra.example.md infra/infra.md` — edit to match your real components
3. `claude login` on the host
4. `docker compose up --build`
5. Open `http://localhost:3000/analyze` — pick a window, hit "Run RCA"
6. Watch the live stream at `/runs/<id>`; once complete, navigate to `/rcas/<id>` and record a resolution

Expected: an RCA appears in MongoDB, optionally posted to Slack; events panel stays empty unless something genuinely failed.

---

## Done

The system is built. The order of value delivery (each provides a checkpoint where you could stop and have a working slice):

- After **Phase 8**: subagents run in parallel against Grafana, produce JSON outputs (no synthesis yet).
- After **Phase 9**: end-to-end RCA cycle works headless (CLI/API).
- After **Phase 12**: full dashboard operational.
- After **Phase 13**: deployable via `docker compose up`.
- After **Phase 14**: Grafana alert auto-triggers RCAs.
- After **Phase 15**: CI gating each PR.

Suggested execution order matches the phase numbering. Phase 14 is intentionally last (user de-prioritized webhook).






