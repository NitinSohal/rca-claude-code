'use client';

import { useEffect, useState } from 'react';

interface IterationCard {
  iteration: number;
  rca?: any;
  stop_decision?: { stop: boolean; reason: string };
  subagentDone: { component: string; output: any }[];
}

export function RunStream({ runId }: { runId: string }) {
  const [iterations, setIterations] = useState<IterationCard[]>([]);
  const [done, setDone] = useState(false);
  const [finalRca, setFinalRca] = useState<any>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.addEventListener('iteration_start', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setIterations((it) => [...it, { iteration: it.length + 1, subagentDone: [] }]);
    });
    es.addEventListener('subagent_done', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setIterations((it) => {
        const cur = it[it.length - 1];
        if (!cur) return it;
        return [...it.slice(0, -1), { ...cur, subagentDone: [...cur.subagentDone, d] }];
      });
    });
    es.addEventListener('iteration_complete', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setIterations((it) => {
        const cur = it[it.length - 1];
        if (!cur) return it;
        return [...it.slice(0, -1), { ...cur, rca: d.rca, stop_decision: d.stop_decision }];
      });
    });
    es.addEventListener('run_complete', (e: MessageEvent) => {
      const d = JSON.parse(e.data);
      setDone(true);
      setFinalRca(d.rca);
    });
    return () => es.close();
  }, [runId]);

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Run {runId}</h2>
      {iterations.map((it) => (
        <details key={it.iteration} open className="border rounded p-3">
          <summary className="font-medium cursor-pointer">
            Iteration {it.iteration} {it.stop_decision && `· ${it.stop_decision.reason}`}
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            {it.subagentDone.map((s) => (
              <div key={s.component} className="border rounded p-2">
                <div className="font-medium">{s.component}</div>
                <div>status: {s.output.status}</div>
                <div>confidence: {s.output.confidence}</div>
              </div>
            ))}
          </div>
          {it.rca && (
            <div className="mt-3 text-sm">
              <div className="font-medium">{it.rca.summary}</div>
              <div className="text-neutral-600">
                Root cause: {it.rca.root_cause.component} ({it.rca.root_cause.confidence})
              </div>
            </div>
          )}
        </details>
      ))}
      {done && finalRca && (
        <div className="bg-green-50 border rounded p-4">
          <h3 className="font-medium">Run complete</h3>
          <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(finalRca, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
