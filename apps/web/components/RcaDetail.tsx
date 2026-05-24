'use client';
import { useEffect, useState } from 'react';

export function RcaDetail({ id }: { id: string }) {
  const [doc, setDoc] = useState<any>(null);
  useEffect(() => { fetch(`/api/rcas/${id}`).then((r) => r.json()).then(setDoc); }, [id]);
  if (!doc) return <p>Loading…</p>;
  const rca = doc.rca;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{rca.summary}</h1>
      <div className="text-sm text-neutral-700">Status: {doc.status}</div>
      <section>
        <h2 className="font-medium">Root cause</h2>
        <p>{rca.root_cause.component} — {rca.root_cause.description} (confidence {rca.root_cause.confidence})</p>
      </section>
      <section>
        <h2 className="font-medium">Timeline</h2>
        <ul className="text-sm">{rca.timeline.map((t: any, i: number) => <li key={i}><strong>{t.ts}:</strong> {t.event}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-medium">Evidence</h2>
        <ul className="text-sm">
          {rca.evidence.map((e: any, i: number) => (
            <li key={i}><strong>{e.component}</strong> {e.type} — {e.excerpt}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-medium">Next steps</h2>
        <ul className="text-sm list-disc pl-6">{rca.suggested_next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
      </section>
      <a href={`/rcas/${id}/resolution`} className="inline-block bg-neutral-900 text-white px-3 py-1.5 rounded">
        Record resolution
      </a>
    </div>
  );
}
