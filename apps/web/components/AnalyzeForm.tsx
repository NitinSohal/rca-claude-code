'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function isoNowMinusHours(h: number): string {
  const d = new Date(Date.now() - h * 3_600_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function AnalyzeForm() {
  const router = useRouter();
  const [from, setFrom] = useState(isoNowMinusHours(4));
  const [to, setTo] = useState(isoNowMinusHours(0));
  const [autoExpand, setAutoExpand] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/rca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          autoExpand,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      router.push(`/runs/${j.runId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <div>
        <label className="block text-sm font-medium">From</label>
        <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded p-1 w-full" required />
      </div>
      <div>
        <label className="block text-sm font-medium">To</label>
        <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded p-1 w-full" required />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoExpand} onChange={(e) => setAutoExpand(e.target.checked)} />
        Auto-expand window if first pass is not conclusive
      </label>
      <button type="submit" disabled={submitting} className="bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50">
        {submitting ? 'Running…' : 'Run RCA'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
