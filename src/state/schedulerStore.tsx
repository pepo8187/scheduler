import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  analyzeAllDaysOff,
  analyzeLunch,
  findLectureConflicts,
  type DayOffAnalysis,
  type LectureConflict,
  type LunchAnalysis,
} from '../domain/analysis';
import { parseTimetable } from '../domain/parseTimetable';
import { applyPreset, DEFAULT_PREFS, type PresetId } from '../domain/presets';
import type { SolveResult } from '../domain/solver';
import type { SolveRequest, SolveResponse } from '../domain/solver.worker';
import { applyTeacherChipClick } from '../domain/teacherFilter';
import type { Day, Prefs, Selection, Timetable } from '../domain/types';

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

interface State extends PersistedState {
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
    };
  }
  return selection;
}

const EMPTY_STATE: State = { xml: null, fileName: null, timetable: null, selection: {}, prefs: DEFAULT_PREFS };

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
      selection: persisted.selection ?? {},
      // Shallow-merged onto the defaults so a preference added after a user's last visit
      // (e.g. `lunch`, absent from older persisted state) doesn't come back `undefined`.
      prefs: { ...DEFAULT_PREFS, ...persisted.prefs },
    };
  } catch {
    return EMPTY_STATE; // corrupt storage or a bad export: start clean rather than crash
  }
}

type Action =
  | { type: 'LOAD_TIMETABLE'; xml: string; fileName: string | null }
  | { type: 'SET_PREFS'; prefs: Partial<Prefs> }
  | { type: 'APPLY_PRESET'; id: PresetId }
  | { type: 'TOGGLE_DAY_OFF'; day: Day }
  | { type: 'TOGGLE_SUBJECT'; subjectCode: string }
  | { type: 'TOGGLE_LECTURE'; subjectCode: string; lectureId: string }
  | { type: 'TOGGLE_LECTURE_REQUIRED'; subjectCode: string; lectureId: string }
  | { type: 'TOGGLE_SEMINAR'; subjectCode: string; seminarId: string }
  | { type: 'TOGGLE_TEACHER_GROUPS'; subjectCode: string; teacherId: string }
  | { type: 'ENABLE_ALL_SEMINARS'; subjectCode: string }
  | { type: 'DISABLE_ALL_SEMINARS'; subjectCode: string }
  | { type: 'RESET_PREFS' }
  | { type: 'CLEAR' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_TIMETABLE': {
      const timetable = parseTimetable(action.xml);
      return {
        xml: action.xml,
        fileName: action.fileName,
        timetable,
        selection: buildDefaultSelection(timetable),
        prefs: DEFAULT_PREFS,
      };
    }

    case 'SET_PREFS':
      return { ...state, prefs: { ...state.prefs, ...action.prefs } };

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
          [action.subjectCode]: {
            ...subject,
            seminars: { ...subject.seminars, [action.seminarId]: !subject.seminars[action.seminarId] },
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
      return { ...state, selection: { ...state.selection, [action.subjectCode]: { ...subjectSelection, seminars } } };
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
      return { ...state, selection: { ...state.selection, [action.subjectCode]: { ...subjectSelection, seminars } } };
    }

    case 'RESET_PREFS':
      return { ...state, prefs: DEFAULT_PREFS };

    case 'CLEAR':
      return EMPTY_STATE;

    default:
      return state;
  }
}

export interface SchedulerActions {
  loadTimetable: (xml: string, fileName: string | null) => void;
  setPrefs: (prefs: Partial<Prefs>) => void;
  applyPreset: (id: PresetId) => void;
  toggleDayOff: (day: Day) => void;
  toggleSubject: (subjectCode: string) => void;
  toggleLecture: (subjectCode: string, lectureId: string) => void;
  toggleLectureRequired: (subjectCode: string, lectureId: string) => void;
  toggleSeminar: (subjectCode: string, seminarId: string) => void;
  toggleTeacherGroups: (subjectCode: string, teacherId: string) => void;
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
  solveResult: SolveResult | null;
  /** True while a solve is debouncing or running in the worker; the last-known solveResult
   *  stays visible in the meantime rather than flashing blank. */
  isSolving: boolean;
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
      applyPreset: (id) => dispatch({ type: 'APPLY_PRESET', id }),
      toggleDayOff: (day) => dispatch({ type: 'TOGGLE_DAY_OFF', day }),
      toggleSubject: (subjectCode) => dispatch({ type: 'TOGGLE_SUBJECT', subjectCode }),
      toggleLecture: (subjectCode, lectureId) => dispatch({ type: 'TOGGLE_LECTURE', subjectCode, lectureId }),
      toggleLectureRequired: (subjectCode, lectureId) =>
        dispatch({ type: 'TOGGLE_LECTURE_REQUIRED', subjectCode, lectureId }),
      toggleSeminar: (subjectCode, seminarId) => dispatch({ type: 'TOGGLE_SEMINAR', subjectCode, seminarId }),
      toggleTeacherGroups: (subjectCode, teacherId) =>
        dispatch({ type: 'TOGGLE_TEACHER_GROUPS', subjectCode, teacherId }),
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

  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // The solver runs off the main thread so a heavy real-world timetable — thousands of
  // node visits even after branch-and-bound — never freezes the UI while it works.
  useEffect(() => {
    if (typeof Worker === 'undefined') return; // no worker support: synchronous fallback below covers it
    const worker = new Worker(new URL('../domain/solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SolveResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale response from a superseded request
      setSolveResult(event.data.result);
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
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsSolving(true);

    const timeout = setTimeout(() => {
      const worker = workerRef.current;
      if (worker) {
        const request: SolveRequest = { requestId, timetable, selection: state.selection, prefs: state.prefs };
        worker.postMessage(request);
      } else {
        // No worker support in this environment: solve synchronously as a fallback.
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
    solveResult,
    isSolving,
    actions,
  };

  return <SchedulerContext.Provider value={value}>{children}</SchedulerContext.Provider>;
}

export function useScheduler(): SchedulerContextValue {
  const context = useContext(SchedulerContext);
  if (!context) throw new Error('useScheduler must be used within a SchedulerProvider');
  return context;
}
