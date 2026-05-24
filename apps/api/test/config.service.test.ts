import { describe, it, expect } from 'vitest';
import { ConfigService } from '../src/config/config.service';

describe('ConfigService', () => {
  const minimal = {
    GRAFANA_URL: 'https://g',
    GRAFANA_SERVICE_ACCOUNT_TOKEN: 't',
    MONGO_URI: 'mongodb://x',
  };
  it('parses a minimal env successfully', () => {
    const c = new ConfigService(minimal);
    expect(c.env.WINDOW_INITIAL_HOURS).toBe(4);
  });
  it('throws on missing required env var', () => {
    expect(() => new ConfigService({})).toThrow(/GRAFANA_URL/);
  });
  it('exposes typed accessor', () => {
    const c = new ConfigService(minimal);
    expect(c.env.GRAFANA_URL).toBe('https://g');
  });
});
