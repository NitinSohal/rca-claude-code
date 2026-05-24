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
