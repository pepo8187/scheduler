import { useEffect, useState } from 'react';
import type { SolveResult } from '../../domain/solver';

interface SolvePerfProps {
  isSolving: boolean;
  /** When the current search started, ms since epoch; null once nothing is running. */
  solveStartedAt: number | null;
  /** Latest sample relayed from the worker, for a solve heavy enough to have posted one. */
  progress: { nodesVisited: number; elapsedMs: number } | null;
  result: SolveResult | null;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function formatRate(nodesVisited: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return '—';
  const perSecond = (nodesVisited / elapsedMs) * 1000;
  return perSecond >= 1000 ? `${(perSecond / 1000).toFixed(1)}k nodes/s` : `${Math.round(perSecond)} nodes/s`;
}

function formatNodes(nodesVisited: number): string {
  return nodesVisited.toLocaleString();
}

/**
 * A performance readout for the search, not just a spinner. There is no honest way to show
 * *percent* complete — branch-and-bound prunes unpredictably, so the total node count isn't
 * known until the search is already done — so what's shown live is the two numbers that
 * actually mean something while it's running: elapsed time and a nodes/s rate, ticking off
 * the worker's throttled progress samples. Once it lands, the same two numbers turn into a
 * fixed receipt, which is the part that actually helps diagnose a slow solve.
 */
export default function SolvePerf({ isSolving, solveStartedAt, progress, result }: SolvePerfProps) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!isSolving) return;
    const id = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(id);
  }, [isSolving]);

  if (isSolving) {
    // Null for the debounce window before the worker is actually dispatched — nothing to time
    // yet, so say so rather than showing a timer that hasn't started.
    const elapsedMs = solveStartedAt !== null ? Math.max(0, tick - solveStartedAt) : null;
    return (
      <div className="solve-perf solve-perf--running">
        <div className="solve-perf__bar" role="progressbar" aria-label="Optimizing">
          <div className="solve-perf__bar-fill" />
        </div>
        <p className="solve-perf__line">
          {elapsedMs === null ? 'Optimizing…' : `Optimizing… ${formatMs(elapsedMs)}`}
          {progress && progress.nodesVisited > 0 && (
            <>
              {' '}
              · {formatNodes(progress.nodesVisited)} nodes · {formatRate(progress.nodesVisited, progress.elapsedMs)}
            </>
          )}
        </p>
      </div>
    );
  }

  if (!result) return null;
  const { elapsedMs, nodesVisited, fallbackIterations } = result.diagnostics;

  return (
    <p className="solve-perf__line solve-perf__line--done">
      Solved in {formatMs(elapsedMs)} · {formatNodes(nodesVisited)} nodes searched · {formatRate(nodesVisited, elapsedMs)}
      {fallbackIterations > 0 && (
        <> · node budget hit, {formatNodes(fallbackIterations)} randomized-fallback iterations</>
      )}
    </p>
  );
}
