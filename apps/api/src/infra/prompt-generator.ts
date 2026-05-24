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
