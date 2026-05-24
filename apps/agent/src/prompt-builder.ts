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
