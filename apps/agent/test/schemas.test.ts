import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../src/schemas/env';
import { ComponentSchema } from '../src/schemas/component';
import { SubagentOutputSchema } from '../src/schemas/subagent-output';
import { RcaOutputSchema } from '../src/schemas/rca-output';

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
      ComponentSchema.parse({ name: 'x', type: 'service', description: 'd' }),
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
        cloudwatch: { namespace: 'AWS/ECS', dimensions: { ClusterName: 'prod', ServiceName: 'auth' }, metrics: ['CPUUtilization'] },
      }),
    ).not.toThrow();
  });
});

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
