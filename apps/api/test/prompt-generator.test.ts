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
