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
