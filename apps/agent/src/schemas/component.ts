import { z } from 'zod';

const kebab = z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be kebab-case');

export const ComponentTypeSchema = z.enum(['service', 'datastore', 'queue', 'cache', 'external']);

export const LokiConfigSchema = z.object({
  selector: z.string().min(1),
  error_filter: z.string().optional(),
});

export const PromMetricSchema = z.object({ name: z.string().min(1), query: z.string().min(1) });
export const PrometheusConfigSchema = z.object({ metrics: z.array(PromMetricSchema).min(1) });

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
