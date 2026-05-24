'use client';
import { useEffect, useState } from 'react';
export default function EventDetail({ params }: { params: { id: string } }) {
  const [doc, setDoc] = useState<any>(null);
  useEffect(() => { fetch(`/api/events/${params.id}`).then((r) => r.json()).then(setDoc); }, [params.id]);
  if (!doc) return <p>Loading…</p>;
  async function act(action: 'resolve' | 'ignore') {
    await fetch(`/api/events/${params.id}/${action}`, { method: 'PATCH' });
    setDoc({ ...doc, status: action === 'resolve' ? 'resolved' : 'ignored' });
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">{doc.severity} · {doc.source}.{doc.operation}</h1>
      <p>{doc.message}</p>
      {doc.suggested_fix && <p className="text-sm text-neutral-600">Suggested fix: {doc.suggested_fix}</p>}
      <pre className="text-xs bg-neutral-100 p-2 rounded">{JSON.stringify(doc.context ?? {}, null, 2)}</pre>
      <div className="flex gap-2">
        <button onClick={() => act('resolve')} className="bg-green-700 text-white rounded px-3 py-1">Mark resolved</button>
        <button onClick={() => act('ignore')} className="border rounded px-3 py-1">Ignore</button>
      </div>
    </div>
  );
}
