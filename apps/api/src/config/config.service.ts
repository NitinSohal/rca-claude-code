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
