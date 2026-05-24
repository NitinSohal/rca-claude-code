'use client';
import { useEffect, useState } from 'react';

export function RcaList() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/rcas').then((r) => r.json()).then(setRows);
  }, []);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r._id} className="border rounded p-3">
          <a href={`/rcas/${r._id}`} className="font-medium underline">{r.rca.summary || '(no summary)'}</a>
          <div className="text-xs text-neutral-500">
            {r.rca.root_cause.component} · confidence {r.rca.root_cause.confidence} · status {r.status}
          </div>
        </li>
      ))}
      {rows.length === 0 && <p className="text-sm text-neutral-500">No RCAs yet.</p>}
    </ul>
  );
}
