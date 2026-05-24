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

export const TimelineEntrySchema = z.object({ ts: z.string(), event: z.string() });

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
