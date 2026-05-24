'use client';
import { useEffect, useState } from 'react';
export function HealthGrid() {
  const [h, setH] = useState<any>(null);
  useEffect(() => {
    fetch('/api/healthz').then((r) => r.json()).then(setH);
  }, []);
  if (!h) return <p>Loading…</p>;
  const Cell = ({ name, ok }: { name: string; ok: boolean }) => (
    <div className={`border rounded p-3 ${ok ? 'bg-green-50' : 'bg-red-50'}`}>
      <div className="text-sm">{name}</div>
      <div className="font-medium">{ok ? 'OK' : 'DOWN'}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-2">
      <Cell name="Grafana" ok={h.grafana} />
      <Cell name="Mongo" ok={h.mongo} />
      <Cell name="Claude auth" ok={h.claude_auth} />
    </div>
  );
}
