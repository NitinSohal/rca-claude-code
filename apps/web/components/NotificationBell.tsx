'use client';

import { useEffect, useState } from 'react';
import { EventDrawer } from './EventDrawer';

interface Counts { critical: number; error: number; warn: number }

export function NotificationBell() {
  const [counts, setCounts] = useState<Counts>({ critical: 0, error: 0, warn: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      try {
        const res = await fetch('/api/healthz');
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setCounts(j.unacknowledged_events ?? { critical: 0, error: 0, warn: 0 });
      } catch {}
    }
    fetchCounts();
    const id = setInterval(fetchCounts, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = counts.critical + counts.error + counts.warn;
  const color = counts.critical > 0 ? 'bg-red-600' : counts.error > 0 ? 'bg-orange-500' : counts.warn > 0 ? 'bg-yellow-500' : 'bg-neutral-400';

  return (
    <>
      <button onClick={() => setOpen((v) => !v)} className="relative p-1" aria-label="Notifications">
        <span className="text-lg">🔔</span>
        {total > 0 && (
          <span className={`absolute -top-1 -right-1 text-[10px] text-white rounded-full px-1 ${color}`}>{total}</span>
        )}
      </button>
      {open && <EventDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
