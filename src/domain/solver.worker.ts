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
  result: ReturnType<typeof solve>;
}

const worker = self as unknown as { onmessage: ((e: MessageEvent<SolveRequest>) => void) | null; postMessage: (msg: SolveResponse) => void };

worker.onmessage = (event) => {
  const { requestId, timetable, selection, prefs } = event.data;
  const result = solve(timetable, selection, prefs);
  worker.postMessage({ requestId, result });
};
