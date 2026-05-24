import type { Params } from 'nestjs-pino';

export function pinoOptions(level: string): Params {
  return {
    pinoHttp: {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-grafana-token"]',
          '*.token',
          '*.secret',
          '*.password',
          '*.GRAFANA_SERVICE_ACCOUNT_TOKEN',
          '*.SLACK_WEBHOOK_URL',
        ],
        censor: '[REDACTED]',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
  };
}
