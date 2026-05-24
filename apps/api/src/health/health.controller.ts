import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

export interface PingService {
  ping(): Promise<boolean>;
}
export interface ClaudeAuthService {
  checkAuth(): Promise<boolean>;
}
export interface EventsCountService {
  getCounts(): { critical: number; error: number; warn: number };
}
export interface InfraStateService {
  getComponents(): { name: string }[];
}

@Controller()
export class HealthController {
  constructor(
    private readonly grafana: PingService,
    private readonly mongo: PingService,
    private readonly claudeAuth: ClaudeAuthService,
    private readonly events: EventsCountService,
    private readonly infra: InfraStateService,
  ) {}

  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  async healthz() {
    const [grafana, mongo, claudeAuth] = await Promise.all([
      this.grafana.ping().catch(() => false),
      this.mongo.ping().catch(() => false),
      this.claudeAuth.checkAuth().catch(() => false),
    ]);
    const ok = grafana && mongo && claudeAuth;
    return {
      status: ok ? 'ok' : 'degraded',
      grafana,
      mongo,
      claude_auth: claudeAuth,
      unacknowledged_events: this.events.getCounts(),
    };
  }

  @Get('readyz')
  async readyz() {
    const components = this.infra.getComponents();
    const [mongo, claudeAuth] = await Promise.all([
      this.mongo.ping().catch(() => false),
      this.claudeAuth.checkAuth().catch(() => false),
    ]);
    if (components.length === 0 || !mongo || !claudeAuth) {
      return { status: 'not_ready', infra_loaded: components.length > 0, mongo, claude_auth: claudeAuth };
    }
    return { status: 'ready' };
  }
}
