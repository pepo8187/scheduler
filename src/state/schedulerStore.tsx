import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  analyzeAllDaysOff,
  analyzeLunch,
  analyzePins,
  findLectureConflicts,
  type DayOffAnalysis,
  type LectureConflict,
  type LunchAnalysis,
  type PinConflict,
} from '../domain/analysis';
import { parseTimetable } from '../domain/parseTimetable';
import { applyPreset, DEFAULT_PREFS, type PresetId } from '../domain/presets';
import { newSeed, normalizeSeed } from '../domain/random';
import { DEFAULT_TUNING } from '../domain/score';
import type { SolveResult } from '../domain/solver';
import type { SolveRequest, SolveResponse, SolveProgress } from '../domain/solver.worker';
import { applyTeacherChipClick } from '../domain/teacherFilter';
import type { Day, Prefs, Selection, SubjectSelection, Timetable, Tuning } from '../domain/types';

const STORAGE_KEY = 'schedule-optimizer:v1';
/** Waits for typing/dragging to settle before kicking off a solve — a slider drag fires many
 *  preference changes per second, and only the last one matters. */
const SOLVE_DEBOUNCE_MS = 150;

interface PersistedState {
  xml: string | null;
  fileName: string | null;
  selection: Selection;
  prefs: Prefs;
}

export interface State extends PersistedState {
  /** Derived from `xml` on load; not persisted directly (rebuilt from `xml` on hydrate). */
  timetable: Timetable | null;
}

function buildDefaultSelection(timetable: Timetable): Selection {
  const selection: Selection = {};
  for (const subject of timetable.subjects) {
    selection[subject.code] = {
      enabled: true,
      lectures: Object.fromEntries(subject.lectures.map((l) => [l.id, { enabled: true, required: false }])),
      seminars: Object.fromEntries(subject.seminars.map((s) => [s.id, true])),
      reclassified: {},
      pinned: {},
    };
  }
  return selection;
}

/**
 * The defaults, carrying a seed. `DEFAULT_PREFS.seed` is deliberately blank — a seed baked into
 * a module constant would hand every student the same "random" week — so every path that
 * resets preferences goes through here and keeps the seed it already had. Resetting your
 * preferences, clearing the file, or loading next semester's export should never silently move
 * you into a different seminar group.
 */
function freshPrefs(seed: string): Prefs {
  return { ...DEFAULT_PREFS, seed: seed || newSeed() };
}

const EMPTY_STATE: State = {
  xml: null,
  fileName: null,
  timetable: null,
  selection: {},
  prefs: freshPrefs(''),
};

/**
 * Brings a persisted selection up to the current shape.
 *
 * Every map added to `SubjectSelection` since a user's last visit is absent from their stored
 * state — `reclassified` and `pinned` both postdate the first release — and an undefined map is
 * a crash waiting for the first reader that indexes it. Default them here, once, rather than
 * making every consumer defensive.
 */
export function migrateSelection(persisted: Selection | undefined): Selection {
  return Object.fromEntries(
    Object.entries(persisted ?? {}).map(([code, sel]) => [
      code,
      { ...sel, reclassified: sel.reclassified ?? {}, pinned: sel.pinned ?? {} },
    ]),
  );
}

function hydrate(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const persisted = JSON.parse(raw) as PersistedState;
    if (!persisted.xml) return EMPTY_STATE;
    return {
      xml: persisted.xml,
      fileName: persisted.fileName ?? null,
      timetable: parseTimetable(persisted.xml),
      selection: migrateSelection(persisted.selection),
      // Shallow-merged onto the defaults so a preference added after a user's last visit
      // (e.g. `lunch`, absent from older persisted state) doesn't come back `undefined`.
      // Nested one level deeper than the rest: a persisted `tuning` from before a knob was
      // added would otherwise leave that knob undefined and NaN its way through the score.
      // The seed can't be defaulted like the rest: a returning visitor from before the feature
      // existed has none stored, and falling back to the shared blank would put every such
      // visitor on identical "random" choices. Mint a real one instead, then persist it.
      prefs: {
        ...DEFAULT_PREFS,
        ...persisted.prefs,
        seed: normalizeSeed(persisted.prefs?.seed ?? '') || newSeed(),
        tuning: { ...DEFAULT_TUNING, ...persisted.prefs?.tuning },
      },
    };
  } catch {
    return EMPTY_STATE; // corrupt storage or a bad export: start clean rather than crash
  }
}

export type Action =
  | { type: 'LOAD_TIMETABLE'; xml: string; fileName: string | null }
  | { type: 'SET_PREFS'; prefs: Partial<Prefs> }
  | { type: 'SET_TUNING'; tuning: Partial<Tuning> }
  | { type: 'RESET_TUNING' }
  | { type: 'APPLY_PRESET'; id: PresetId }
  | { type: 'TOGGLE_DAY_OFF'; day: Day }
  | { type: 'TOGGLE_SUBJECT'; subjectCode: string }
  | { type: 'TOGGLE_LECTURE'; subjectCode: string; lectureId: string }
  | { type: 'TOGGLE_LECTURE_REQUIRED'; subjectCode: string; lectureId: string }
  | { type: 'TOGGLE_SEMINAR'; subjectCode: string; seminarId: string }
  | { type: 'TOGGLE_SEMINAR_RECLASSIFIED'; subjectCode: string; seminarId: string }
  | { type: 'TOGGLE_SEMINAR_PINNED'; subjectCode: string; seminarId: string }
  | { type: 'TOGGLE_TEACHER_GROUPS'; subjectCode: string; teacherId: string }
  | { type: 'ENABLE_ALL_SEMINARS'; subjectCode: string }
  | { type: 'DISABLE_ALL_SEMINARS'; subjectCode: string }
  | { type: 'SET_SEED'; seed: string }
  | { type: 'REROLL_SEED' }
  | { type: 'RESET_PREFS' }
  | { type: 'CLEAR' };

/**
 * Drops any pin whose group is no longer a live candidate.
 *
 * A pin says "I want this group" and only means anything while the group is one the solver
 * could pick: switching it off, filtering it away with a teacher chip, or reclassifying it as
 * a lecture all make the pin a statement about nothing. Leaving it behind would have it spring
 * back the next time the group was re-enabled, which is not what anyone asked for. Hard
 * constraints are deliberately *not* handled here — a day off should not silently delete a pin
 * the user might want back tomorrow, so the solver ignores it for that solve and `analyzePins`
 * says so.
 */
function prunePins(subject: SubjectSelection): SubjectSelection {
  const live = Object.fromEntries(
    Object.entries(subject.pinned).filter(([id, on]) => on && subject.seminars[id] && !subject.reclassified[id]),
  );
  return Object.keys(live).length === Object.keys(subject.pinned).length ? subject : { ...subject, pinned: live };
}

/** Exported for tests: a pure function of state and action, no React involved. */
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_TIMETABLE': {
      const timetable = parseTimetable(action.xml);
      return {
        xml: action.xml,
        fileName: action.fileName,
        timetable,
        selection: buildDefaultSelection(timetable),
        prefs: freshPrefs(state.prefs.seed),
      };
    }

    case 'SET_PREFS':
      return { ...state, prefs: { ...state.prefs, ...action.prefs } };

    case 'SET_TUNING':
      return { ...state, prefs: { ...state.prefs, tuning: { ...state.prefs.tuning, ...action.tuning } } };

    case 'RESET_TUNING':
      return { ...state, prefs: { ...state.prefs, tuning: DEFAULT_TUNING } };

    case 'APPLY_PRESET':
      return { ...state, prefs: applyPreset(state.prefs, action.id) };

    case 'TOGGLE_DAY_OFF': {
      const daysOff = state.prefs.daysOff.includes(action.day)
        ? state.prefs.daysOff.filter((d) => d !== action.day)
        : [...state.prefs.daysOff, action.day];
      return { ...state, prefs: { ...state.prefs, daysOff } };
    }

    case 'TOGGLE_SUBJECT': {
      const subject = state.selection[action.subjectCode];
      if (!subject) return state;
      return {
        ...state,
        selection: { ...state.selection, [action.subjectCode]: { ...subject, enabled: !subject.enabled } },
      };
    }

    case 'TOGGLE_LECTURE': {
      const subject = state.selection[action.subjectCode];
      const lecture = subject?.lectures[action.lectureId];
      if (!subject || !lecture) return state;
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.subjectCode]: {
            ...subject,
            lectures: { ...subject.lectures, [action.lectureId]: { ...lecture, enabled: !lecture.enabled } },
          },
        },
      };
    }

    case 'TOGGLE_LECTURE_REQUIRED': {
      const subject = state.selection[action.subjectCode];
      const lecture = subject?.lectures[action.lectureId];
      if (!subject || !lecture) return state;
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.subjectCode]: {
            ...subject,
            lectures: { ...subject.lectures, [action.lectureId]: { ...lecture, required: !lecture.required } },
          },
        },
      };
    }

    case 'TOGGLE_SEMINAR': {
      const subject = state.selection[action.subjectCode];
      if (!subject || !(action.seminarId in subject.seminars)) return state;
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.subjectCode]: prunePins({
            ...subject,
            seminars: { ...subject.seminars, [action.seminarId]: !subject.seminars[action.seminarId] },
          }),
        },
      };
    }

    case 'TOGGLE_SEMINAR_RECLASSIFIED': {
      const subject = state.selection[action.subjectCode];
      if (!subject || !(action.seminarId in subject.seminars)) return state;
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.subjectCode]: prunePins({
            ...subject,
            reclassified: { ...subject.reclassified, [action.seminarId]: !subject.reclassified[action.seminarId] },
          }),
        },
      };
    }

    /**
     * At most one pin per subject: pinning a second group replaces the first rather than
     * accumulating, since a subject only ever attends one. Clicking the pinned group again
     * un-pins it, which is the whole un-pin affordance — nothing else needs a "clear pins".
     * A pin implies enabling, so pinning a group the user had switched off switches it back on
     * rather than creating a pin the solver would immediately have to ignore.
     */
    case 'TOGGLE_SEMINAR_PINNED': {
      const subject = state.selection[action.subjectCode];
      if (!subject || !(action.seminarId in subject.seminars)) return state;
      if (subject.reclassified[action.seminarId]) return state; // no group choice left to pin
      const alreadyPinned = subject.pinned[action.seminarId] ?? false;
      return {
        ...state,
        selection: {
          ...state.selection,
          [action.subjectCode]: {
            ...subject,
            seminars: alreadyPinned ? subject.seminars : { ...subject.seminars, [action.seminarId]: true },
            pinned: alreadyPinned ? {} : { [action.seminarId]: true },
          },
        },
      };
    }

    case 'TOGGLE_TEACHER_GROUPS': {
      const timetableSubject = state.timetable?.subjects.find((s) => s.code === action.subjectCode);
      const subjectSelection = state.selection[action.subjectCode];
      if (!timetableSubject || !subjectSelection) return state;
      // The rule itself (first click exclusive, the rest additive) lives in the domain so it can
      // be tested without a DOM.
      const seminars = applyTeacherChipClick(timetableSubject.seminars, subjectSelection.seminars, action.teacherId);
      return {
        ...state,
        selection: { ...state.selection, [action.subjectCode]: prunePins({ ...subjectSelection, seminars }) },
      };
    }

    case 'ENABLE_ALL_SEMINARS': {
      const timetableSubject = state.timetable?.subjects.find((s) => s.code === action.subjectCode);
      const subjectSelection = state.selection[action.subjectCode];
      if (!timetableSubject || !subjectSelection) return state;
      const seminars = Object.fromEntries(timetableSubject.seminars.map((s) => [s.id, true]));
      return { ...state, selection: { ...state.selection, [action.subjectCode]: { ...subjectSelection, seminars } } };
    }

    case 'DISABLE_ALL_SEMINARS': {
      const timetableSubject = state.timetable?.subjects.find((s) => s.code === action.subjectCode);
      const subjectSelection = state.selection[action.subjectCode];
      if (!timetableSubject || !subjectSelection) return state;
      const seminars = Object.fromEntries(timetableSubject.seminars.map((s) => [s.id, false]));
      return {
        ...state,
        selection: { ...state.selection, [action.subjectCode]: prunePins({ ...subjectSelection, seminars }) },
      };
    }

    case 'SET_SEED': {
      const seed = normalizeSeed(action.seed);
      if (!seed) return state; // an empty box is mid-edit, not a request for a blank seed
      return { ...state, prefs: { ...state.prefs, seed } };
    }

    case 'REROLL_SEED':
      return { ...state, prefs: { ...state.prefs, seed: newSeed() } };

    case 'RESET_PREFS':
      return { ...state, prefs: freshPrefs(state.prefs.seed) };

    case 'CLEAR':
      return { ...EMPTY_STATE, prefs: freshPrefs(state.prefs.seed) };

    default:
      return state;
  }
}

export interface SchedulerActions {
  loadTimetable: (xml: string, fileName: string | null) => void;
  setPrefs: (prefs: Partial<Prefs>) => void;
  setTuning: (tuning: Partial<Tuning>) => void;
  resetTuning: () => void;
  applyPreset: (id: PresetId) => void;
  toggleDayOff: (day: Day) => void;
  toggleSubject: (subjectCode: string) => void;
  toggleLecture: (subjectCode: string, lectureId: string) => void;
  toggleLectureRequired: (subjectCode: string, lectureId: string) => void;
  toggleSeminar: (subjectCode: string, seminarId: string) => void;
  toggleSeminarReclassified: (subjectCode: string, seminarId: string) => void;
  toggleSeminarPinned: (subjectCode: string, seminarId: string) => void;
  toggleTeacherGroups: (subjectCode: string, teacherId: string) => void;
  setSeed: (seed: string) => void;
  rerollSeed: () => void;
  enableAllSeminars: (subjectCode: string) => void;
  disableAllSeminars: (subjectCode: string) => void;
  resetPrefs: () => void;
  clear: () => void;
}

export interface SchedulerContextValue {
  xml: string | null;
  fileName: string | null;
  timetable: Timetable | null;
  selection: Selection;
  prefs: Prefs;
  dayOffAnalysis: Record<Day, DayOffAnalysis> | null;
  lectureConflicts: LectureConflict[];
  lunchAnalysis: LunchAnalysis | null;
  /** Pins a day off or the lunch block has overruled — reported, never silently dropped. */
  pinConflicts: PinConflict[];
  solveResult: SolveResult | null;
  /** True while a solve is debouncing or running in the worker; the last-known solveResult
   *  stays visible in the meantime rather than flashing blank. */
  isSolving: boolean;
  /** When the search itself (not the debounce) started, so the UI can tick a live timer.
   *  Null whenever nothing is actually running in the worker yet. */
  solveStartedAt: number | null;
  /** Latest progress relayed from the worker on a solve heavy enough to report one; null until
   *  the current solve's first sample arrives, and reset to null at the start of every solve. */
  solveProgress: { nodesVisited: number; elapsedMs: number } | null;
  actions: SchedulerActions;
}

const SchedulerContext = createContext<SchedulerContextValue | null>(null);

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, hydrate);

  useEffect(() => {
    try {
      const persisted: PersistedState = {
        xml: state.xml,
        fileName: state.fileName,
        selection: state.selection,
        prefs: state.prefs,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Private browsing or blocked storage: the app still works for this session.
    }
  }, [state.xml, state.fileName, state.selection, state.prefs]);

  const actions = useMemo<SchedulerActions>(
    () => ({
      loadTimetable: (xml, fileName) => dispatch({ type: 'LOAD_TIMETABLE', xml, fileName }),
      setPrefs: (prefs) => dispatch({ type: 'SET_PREFS', prefs }),
      setTuning: (tuning) => dispatch({ type: 'SET_TUNING', tuning }),
      resetTuning: () => dispatch({ type: 'RESET_TUNING' }),
      applyPreset: (id) => dispatch({ type: 'APPLY_PRESET', id }),
      toggleDayOff: (day) => dispatch({ type: 'TOGGLE_DAY_OFF', day }),
      toggleSubject: (subjectCode) => dispatch({ type: 'TOGGLE_SUBJECT', subjectCode }),
      toggleLecture: (subjectCode, lectureId) => dispatch({ type: 'TOGGLE_LECTURE', subjectCode, lectureId }),
      toggleLectureRequired: (subjectCode, lectureId) =>
        dispatch({ type: 'TOGGLE_LECTURE_REQUIRED', subjectCode, lectureId }),
      toggleSeminar: (subjectCode, seminarId) => dispatch({ type: 'TOGGLE_SEMINAR', subjectCode, seminarId }),
      toggleSeminarReclassified: (subjectCode, seminarId) =>
        dispatch({ type: 'TOGGLE_SEMINAR_RECLASSIFIED', subjectCode, seminarId }),
      toggleSeminarPinned: (subjectCode, seminarId) => dispatch({ type: 'TOGGLE_SEMINAR_PINNED', subjectCode, seminarId }),
      toggleTeacherGroups: (subjectCode, teacherId) =>
        dispatch({ type: 'TOGGLE_TEACHER_GROUPS', subjectCode, teacherId }),
      setSeed: (seed) => dispatch({ type: 'SET_SEED', seed }),
      rerollSeed: () => dispatch({ type: 'REROLL_SEED' }),
      enableAllSeminars: (subjectCode) => dispatch({ type: 'ENABLE_ALL_SEMINARS', subjectCode }),
      disableAllSeminars: (subjectCode) => dispatch({ type: 'DISABLE_ALL_SEMINARS', subjectCode }),
      resetPrefs: () => dispatch({ type: 'RESET_PREFS' }),
      clear: () => dispatch({ type: 'CLEAR' }),
    }),
    [],
  );

  const dayOffAnalysis = useMemo(
    () => (state.timetable ? analyzeAllDaysOff(state.timetable, state.selection) : null),
    [state.timetable, state.selection],
  );

  const lectureConflicts = useMemo(
    () => (state.timetable ? findLectureConflicts(state.timetable, state.selection) : []),
    [state.timetable, state.selection],
  );

  const lunchAnalysis = useMemo(
    () => (state.timetable ? analyzeLunch(state.timetable, state.selection, state.prefs.lunch) : null),
    [state.timetable, state.selection, state.prefs.lunch],
  );

  const pinConflicts = useMemo(
    () => (state.timetable ? analyzePins(state.timetable, state.selection, state.prefs.daysOff, state.prefs.lunch) : []),
    [state.timetable, state.selection, state.prefs.daysOff, state.prefs.lunch],
  );

  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [solveStartedAt, setSolveStartedAt] = useState<number | null>(null);
  const [solveProgress, setSolveProgress] = useState<{ nodesVisited: number; elapsedMs: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // The solver runs off the main thread so a heavy real-world timetable — thousands of
  // node visits even after branch-and-bound — never freezes the UI while it works.
  useEffect(() => {
    if (typeof Worker === 'undefined') return; // no worker support: synchronous fallback below covers it
    const worker = new Worker(new URL('../domain/solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SolveResponse | SolveProgress>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale response from a superseded request
      if (event.data.type === 'progress') {
        setSolveProgress({ nodesVisited: event.data.nodesVisited, elapsedMs: event.data.elapsedMs });
        return;
      }
      setSolveResult(event.data.result);
      setSolveProgress(null);
      setIsSolving(false);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Debounced so a slider drag or a burst of toggles — many preference changes per second —
  // triggers one solve, not dozens; stale in-flight requests are dropped by requestId above.
  useEffect(() => {
    const timetable = state.timetable;
    if (!timetable) {
      requestIdRef.current++;
      setSolveResult(null);
      setIsSolving(false);
      setSolveStartedAt(null);
      setSolveProgress(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsSolving(true);
    // Cleared for the debounce window too, not just while the worker runs — otherwise the
    // timer would keep counting up from the *previous* solve's start while this one is still
    // waiting for typing to settle.
    setSolveStartedAt(null);
    setSolveProgress(null);

    const timeout = setTimeout(() => {
      // Timed from here, not from the debounce above — the wait for typing to settle isn't
      // part of the calculation, and a timer that included it would overstate every solve by
      // a constant that has nothing to do with timetable size.
      setSolveStartedAt(Date.now());
      setSolveProgress(null);
      const worker = workerRef.current;
      if (worker) {
        const request: SolveRequest = { requestId, timetable, selection: state.selection, prefs: state.prefs };
        worker.postMessage(request);
      } else {
        // No worker support in this environment: solve synchronously as a fallback, which
        // freezes this thread for the duration — a live timer couldn't render anyway.
        import('../domain/solver').then(({ solve }) => {
          if (requestId !== requestIdRef.current) return;
          setSolveResult(solve(timetable, state.selection, state.prefs));
          setIsSolving(false);
        });
      }
    }, SOLVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [state.timetable, state.selection, state.prefs]);

  const value: SchedulerContextValue = {
    xml: state.xml,
    fileName: state.fileName,
    timetable: state.timetable,
    selection: state.selection,
    prefs: state.prefs,
    dayOffAnalysis,
    lectureConflicts,
    lunchAnalysis,
    pinConflicts,
    solveResult,
    isSolving,
    solveStartedAt,
    solveProgress,
    actions,
  };

  return <SchedulerContext.Provider value={value}>{children}</SchedulerContext.Provider>;
}

export function useScheduler(): SchedulerContextValue {
  const context = useContext(SchedulerContext);
  if (!context) throw new Error('useScheduler must be used within a SchedulerProvider');
  return context;
}
