export interface DiscoveryInput {
  baseUrl: string;
  token: string;
}

export interface DiscoveredUids {
  loki?: string;
  prom?: string;
  cw?: string;
}

interface DsRow {
  uid: string;
  type: string;
  name: string;
}

export async function discoverDatasources(input: DiscoveryInput): Promise<DiscoveredUids> {
  const res = await fetch(`${input.baseUrl.replace(/\/$/, '')}/api/datasources`, {
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!res.ok) throw new Error(`Grafana datasource list returned ${res.status}`);
  const rows = (await res.json()) as DsRow[];

  const find = (t: string) => rows.find((r) => r.type === t)?.uid;
  return {
    loki: find('loki'),
    prom: find('prometheus'),
    cw: find('cloudwatch'),
  };
}
