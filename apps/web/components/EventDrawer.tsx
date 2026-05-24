'use client';

import { useEffect, useState } from 'react';

interface EventRow {
  _id: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  source: string;
  operation: string;
  message: string;
  created_at: string;
  suggested_fix?: string | null;
}

const sevColor: Record<string, string> = {
  critical: 'text-red-700',
  error: 'text-orange-600',
  warn: 'text-yellow-600',
  info: 'text-neutral-500',
};

export function EventDrawer({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => {
    fetch('/api/events/unacknowledged').then((r) => r.json()).then(setRows).catch(() => {});
  }, []);

  async function ignore(id: string) {
    await fetch(`/api/events/${id}/ignore`, { method: 'PATCH' });
    setRows((r) => r.filter((x) => x._id !== id));
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white border-l shadow-lg p-4 overflow-y-auto z-50">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Unacknowledged events</h2>
        <button onClick={onClose} className="text-sm">✕</button>
      </div>
      {rows.length === 0 && <p className="text-sm text-neutral-500">All clear.</p>}
      <ul className="space-y-3">
        {rows.map((e) => (
          <li key={e._id} className="border rounded p-2 text-sm">
            <div className={`font-medium ${sevColor[e.severity]}`}>{e.severity} · {e.source}.{e.operation}</div>
            <div className="text-neutral-700">{e.message}</div>
            {e.suggested_fix && <div className="text-xs text-neutral-500 mt-1">Fix: {e.suggested_fix}</div>}
            <div className="flex gap-2 mt-2">
              <a href={`/events/${e._id}`} className="text-xs underline">View</a>
              <button onClick={() => ignore(e._id)} className="text-xs underline">Ignore</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
