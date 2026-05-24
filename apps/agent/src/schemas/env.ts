import { z } from 'zod';

const num = (def: number) => z.coerce.number().default(def);

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
