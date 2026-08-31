import { solve } from './solver';
import type { Prefs, Selection, Timetable } from './types';

/**
 * The solve on a heavy real-world timetable can still take a few hundred milliseconds even
 * after the algorithmic work (branch-and-bound, group-collapsing) — running it here keeps
 * the main thread free to keep the UI responsive while it works. `schedulerStore` debounces
 * requests and drops stale responses by `requestId`, so this worker doesn't need to know
 * about cancellation itself: it just answers whatever it's asked, in order.
 */
export interface SolveRequest {
  requestId: number;
  timetable: Timetable;
  selection: Selection;
  prefs: Prefs;
}

export interface SolveResponse {
  requestId: number;
  type: 'result';
  result: ReturnType<typeof solve>;
}

/**
 * Relayed while a heavy solve is still running, so the UI can show a live timer and node
 * count instead of a bar that either lies about progress or sits frozen. Throttled to roughly
 * 10/second below — `solve`'s own sampling already caps how often this could fire, but a
 * pathologically fast node rate could still flood `postMessage` without a second gate.
 */
export interface SolveProgress {
  requestId: number;
  type: 'progress';
  nodesVisited: number;
  elapsedMs: number;
}

const PROGRESS_INTERVAL_MS = 100;

const worker = self as unknown as {
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (msg: SolveResponse | SolveProgress) => void;
};

worker.onmessage = (event) => {
  const { requestId, timetable, selection, prefs } = event.data;
  let lastPostedAt = -Infinity;
  const result = solve(timetable, selection, prefs, {
    onProgress: (nodesVisited, elapsedMs) => {
      if (elapsedMs - lastPostedAt < PROGRESS_INTERVAL_MS) return;
      lastPostedAt = elapsedMs;
      worker.postMessage({ requestId, type: 'progress', nodesVisited, elapsedMs });
    },
  });
  worker.postMessage({ requestId, type: 'result', result });
};
