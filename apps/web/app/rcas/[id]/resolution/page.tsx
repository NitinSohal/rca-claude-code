'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResolutionPage({ params }: { params: { id: string } }) {
  const r = useRouter();
  const [note, setNote] = useState('');
  const [steps, setSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    await fetch(`/api/rcas/${params.id}/resolution`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', note, steps: steps.split('\n').filter(Boolean) }),
    });
    r.push(`/rcas/${params.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-md">
      <h1 className="text-lg font-semibold">Record resolution</h1>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you did to fix it" className="border rounded p-2 w-full h-32" required />
      <textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="One step per line (optional)" className="border rounded p-2 w-full h-32" />
      <button type="submit" disabled={submitting} className="bg-neutral-900 text-white rounded px-4 py-2">
        {submitting ? 'Saving…' : 'Save resolution'}
      </button>
    </form>
  );
}
