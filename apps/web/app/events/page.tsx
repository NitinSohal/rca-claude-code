'use client';
import { useEffect, useState } from 'react';
export default function EventsPage() {
  const [severity, setSeverity] = useState<string>('');
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    const qs = severity ? `?severity=${severity}` : '';
    fetch(`/api/events${qs}`).then((r) => r.json()).then(setRows);
  }, [severity]);
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Events</h1>
      <div className="mb-3">
        <label>Severity </label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="border p-1 rounded">
          <option value="">all</option>
          <option value="critical">critical</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
        </select>
      </div>
      <ul className="space-y-2">
        {rows.map((e) => (
          <li key={e._id} className="border rounded p-2 text-sm">
            <div><strong>{e.severity}</strong> · {e.source}.{e.operation} · {e.status}</div>
            <div className="text-neutral-700">{e.message}</div>
            <a href={`/events/${e._id}`} className="text-xs underline">Detail</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
