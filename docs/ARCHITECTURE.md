# Schedule Optimizer — architecture and domain reference

This is the reference document for the app: what it is for, what its rules are, how the
pieces fit together, and why each non-obvious decision was made that way. It is written to be
read cold — by a contributor, or by an agent picking the codebase up with no other context —
and to be the first place to check before changing anything in `src/domain/`.

It grew out of the implementation plan that this file used to hold; that plan's original text
(session split, work order, verification checklist) is in git history and is no longer worth
carrying forward. What was worth keeping — the design rules, the measurements behind them, and
the alternatives that were tried and rejected — is folded into the sections below.

**Where the other docs stop and this one starts.** [`README.md`](../README.md) is the
user-facing how-it-works: what the controls do and what the score means in plain language.
[`docs/DEPLOY.md`](DEPLOY.md) is build and hosting. [`docs/plans/`](plans/) holds design
proposals for work that has *not* been built. This document is the internal reference: the
model, the algorithms, the invariants, and the reasoning.

---

## Contents

1. [What the app is](#1-what-the-app-is)
2. [Governing rules](#2-governing-rules)
3. [The input format](#3-the-input-format)
4. [Domain model](#4-domain-model)
5. [How a solve happens](#5-how-a-solve-happens)
6. [Module map](#6-module-map)
7. [Constraints vs. preferences](#7-constraints-vs-preferences)
8. [The objective function](#8-the-objective-function)
9. [The solver](#9-the-solver)
10. [Variation across a cohort](#10-variation-across-a-cohort)
11. [State, persistence and the worker](#11-state-persistence-and-the-worker)
12. [The interface](#12-the-interface)
13. [Tests and fixtures](#13-tests-and-fixtures)
14. [Decisions and rejected alternatives](#14-decisions-and-rejected-alternatives)
15. [Known gaps and open work](#15-known-gaps-and-open-work)
16. [Glossary](#16-glossary)

---

## 1. What the app is

A single-page, entirely client-side web app that reads a **MUNI IS timetable export** (the
`<rozvrh>` XML the university's information system produces) and computes the best personal
weekly schedule for one student.

**The decision it exists to make is: which seminar group of each subject to take.**

That framing drives everything else:

- **Lectures are givens.** The faculty fixes them. A student attends or doesn't; there is
  nothing to optimise. They enter the search as fixed input, placed before it starts.
- **Seminar groups are the choice.** A subject may offer thirty parallel groups at thirty
  different hours, and picking one changes what is still possible for every other subject.
  That interaction is what makes the problem tedious by hand and worth solving by machine.
- **The user narrows, the app chooses.** The sidebar is for pruning candidates (drop a
  subject, drop groups, keep only one teacher's groups); the preferences panel says what a
  good week looks like; the solver picks the best combination consistent with both.

### Non-goals

Stated explicitly because each has been asked about and each is a real boundary:

- **It does not register anybody for anything.** It proposes; the university's system
  allocates, and registration order still decides reality.
- **It does not coordinate between users.** Two students can still draw the same group — see
  [§10](#10-variation-across-a-cohort) for what the variation machinery does and does not
  claim.
- **It has no server.** No backend, no database, no accounts. A timetable export never leaves
  the machine that opened it: the file is read with `FileReader`, parsed in-page, and solved
  in a Web Worker. Hosting the app publishes the app, not anybody's schedule.
- **It does not model course content, credits, prerequisites or capacity.** The export carries
  none of that, and the app invents nothing.

---

## 2. Governing rules

These are the invariants. Everything downstream assumes them, several are load-bearing for
correctness rather than taste, and breaking one silently is the failure mode to watch for.
Check a change against this list before shipping it.

| # | Rule | Why, and what enforces it |
| --- | --- | --- |
| 1 | **Never return zero schedules.** | A subject whose every group is filtered out becomes "no seminar chosen", never an empty domain (`buildVariables`). Unavoidable collisions are scored and shaded, never rejected. |
| 2 | **Hard constraints filter the domain; comfort is scored.** | Days off and the lunch block remove values before the search (`buildVariables`). Everything else is a weighted term. Never convert one into the other without re-reading [§7](#7-constraints-vs-preferences). |
| 3 | **Weight ordering: collision ≫ dropped lecture ≫ every comfort term.** | 100 000 vs. 2 000 vs. tens of points (`DEFAULT_TUNING`). The solver only ever trades comfort for comfort. |
| 4 | **The search's lower bound must read the same numbers the score does.** | Both read `prefs.tuning`. If the bound kept the defaults while the score used the user's edits, the search would prune genuine optima the moment anyone touched the Advanced panel. A brute-force cross-check under non-default tuning covers this (`solver.test.ts`). |
| 5 | **Every score term is non-negative.** | Attending more is never a discount. This is what makes the branch-and-bound bound admissible. |
| 6 | **Parity may only ever remove a constraint, never add one.** | Anything unreadable in a `<poznamky>` note falls back to "meets every week" (`parity.ts`). The tolerable failure is a clash shown that isn't real — never a promise of no clash that turns out false. |
| 7 | **No unseeded randomness anywhere in the domain layer.** | Every draw is a pure function of `prefs.seed` plus coordinates (`random.ts`). The store re-solves on every preference change; `Math.random` would reshuffle the week on each slider tick. |
| 8 | **Variety re-ranks, it never perturbs the objective.** | A jittered score would be a lie on screen *and* would invalidate the bound in rule 4. `variety.ts` runs after the search, inside a tolerance band. |
| 9 | **Lectures are never dropped except to satisfy a day off, and ★ lectures never at all.** | `deriveDroppedLectures`. A day off blocked by a ★ lecture is caught in `analysis.ts` before the solver runs. |
| 10 | **Two events of the same subject are never compared for overlap.** | Only one of a subject's groups is ever selected, so two Friday-only groups of one subject are not a conflict (`findOverlaps`, and the `otherFixed` filter in `buildVariables`). |
| 11 | **`src/domain/` imports no React and touches no DOM** beyond `DOMParser` in the parser. | It runs in a Web Worker and in vitest/jsdom. |
| 12 | **The alternatives strip stays sorted by true score.** | Variety marks a rung; it never reorders the ladder, or "#1" could sit above a cheaper "#2". |
| 13 | **`resolveAssignment` runs at most once per candidate.** | The solver's hot loop resolves once and calls `scoreResolved` with the result. |

---

## 3. The input format

The export is XML rooted at `<rozvrh>`. Everything the app knows comes from it.

```
<rozvrh>
  <minhod>480</minhod>  <maxhod>1200</maxhod>     structural grid bounds (08:00-20:00)
  <hodiny><hodina><od/><do/></hodina>…</hodiny>   the hour ruler, 12 rows
  <tabulka>
    <den id="Po|Út|St|Čt|Pá" rows="N">
      <radek>                                     a stacking row: layout only, no meaning
        <slot odcas="08:00" docas="09:40">
          <mistnosti><mistnost><mistnostid/><mistnostozn/></mistnost>…</mistnosti>
          <akce><kod/><nazev/><predmetid/><fakulta_url/><obdobi_url/></akce>
          <poznamka id="N"/>                      an empty *reference*; text lives in <poznamky>
          <ucitele><ucitel><ucitelid/><uciteljmeno/></ucitel>…</ucitele>
        </slot>
        <break/>                                  ignored
      </radek>
    </den>
  </tabulka>
  <poznamky><poznamka id="N">…text…</poznamka>…</poznamky>
  <nezname><akce>…</akce></nezname>               course editions with no scheduled time
</rozvrh>
```

Facts about the format that the parser depends on, each verified against real exports:

- **`minhod`/`maxhod` are structural, not preferences.** They say the timetable is *drawn*
  08:00–20:00. They are unrelated to the user's day-window preference, which defaults to the
  same range precisely so it applies no nudge until moved.
- **`<radek>` rows carry no meaning.** They exist to stack simultaneous options in the school
  system's own grid. The parser walks every `radek` and discards the row index.
- **Rooms and teachers are repeated once per teaching week** — typically 12 identical copies —
  and are de-duplicated by id on parse (`dedupeById`).
- **A slot's `<poznamka id>` is a reference.** The text lives once, in the document-final
  `<poznamky>` block. Resolving it is not optional decoration: it is the *only* place the
  export records fortnightly scheduling (below).
- **`<nezname>` entries have no time** (substitute sessions, state exams, thesis defence).
  They are listed in a tray and never scheduled.
- **Extra or unknown `den` ids are tolerated** by the parser. Note the limitation in
  [§15](#15-known-gaps-and-open-work): the grid draws Mon–Fri only.

### The code convention

`<akce><kod>` is the whole classification:

- `IB111` — a **lecture** of subject `IB111`
- `IB111/03` — **seminar group `03`** of subject `IB111`

The regex is `^(.+?)\/(.+)$` — *any* slash marks a seminar group. Group labels are not always
numeric: `IB000/AA`, `PB173/qt`, `PB173/git` are all real. Slots sharing a `kod` merge into one
`CourseEvent`; picking a group is all-or-nothing across its weekly meetings.

A subject may have a lecture and groups, a lecture only, or groups only (a language class with
several groups and no lecture). All three are supported; the bundled exports don't happen to
include the third, so it is covered by synthetic fixtures instead.

### Alternating-week (fortnightly) seminars

Some seminars meet every other week, and the export says so **only in the prose of a note**:

> `každé liché pondělí 10:00–11:50` — every **odd** Monday
> `každé sudé pondělí 10:00–11:50` — every **even** Monday

This was originally written off as decoration, and that was wrong — it only looked right
because podzim2023, the first bundled sample, contains no notes at all. podzim2022 has 40, and
39 of them carry scheduling information the app cannot be correct without: `IB015/05` and
`IB015/06` are not two interchangeable groups at the same hour, they are the two halves of one
fortnight.

Three properties of the source data, verified across podzim2022's 40 notes and 79 noted slots,
are what make the one-flag-per-slot model sufficient:

- **Odd/even is one global fortnightly cycle**, not a per-weekday phase. Every date listed in
  every parity note falls in an ISO week of the stated parity, so an "odd Monday" and an "odd
  Thursday" are the same calendar week.
- **The note agrees with its slot.** All 79 name a weekday and time range matching the slot's
  own `den`/`odcas`/`docas`. Parity comes from the note; day and time from the attributes.
- **Twins are not guaranteed.** `PB154` has `/02` and `/04` even-only with no odd partner, and
  `/13` odd-only. Nothing may assume a group has an opposite-parity counterpart.

Notes that aren't about parity — one overflow-room note, the only one carrying anchor markup —
parse to `undefined` and the slot stays weekly, per rule 6. A secondary corroborating signal
exists and is deliberately unused: `<mistnost>` repeats once per actual occurrence (12–13 for
weekly, 6–7 odd, 5–6 even), so the repeat count betrays a fortnightly slot but cannot say which
half.

`parseNoteParity` spells out the Czech adjective endings rather than stem-matching
`lich…`/`sud…`: a bare stem also fires on unrelated words that merely start the same way (the
teacher surname "Sudová" is the case that caught it), and a false parity would silently delete
a real collision.

---

## 4. Domain model

All in [`src/domain/types.ts`](../src/domain/types.ts). Pure data; times are **minutes from
midnight** throughout (`format.ts` converts at the edges).

```ts
type Day = 'Po' | 'Út' | 'St' | 'Čt' | 'Pá' | 'So' | 'Ne';
type WeekParity = 'odd' | 'even';           // undefined on a Slot means "every week"

interface Slot {                            // one meeting in the week
  day: Day; start: number; end: number;
  rooms: string[]; teachers: Teacher[];
  noteId?: string; note?: string;           // resolved from <poznamky>
  parity?: WeekParity;                      // read out of `note`
}

interface CourseEvent {                     // one enrollable unit
  id: string;                               // "IB111" | "IB111/03"
  subjectCode: string;                      // "IB111"
  kind: 'lecture' | 'seminar';
  group?: string;                           // "03"
  slots: Slot[];                            // >1 when the group meets several times a week
  teachers: Teacher[];                      // de-duplicated union across slots
}

interface Subject { code; name; subjectId; facultyUrl; periodUrl;
                    lectures: CourseEvent[]; seminars: CourseEvent[] }

interface Timetable { minHour; maxHour; hours: HourRulerEntry[];
                      subjects: Subject[]; unscheduled: UnscheduledCourse[] }
```

Three orthogonal state objects sit on top of the parsed `Timetable`, and keeping them separate
is what keeps the app comprehensible:

| Object | Owns | Persisted |
| --- | --- | --- |
| `Timetable` | What the export says exists. Never mutated after parse. | as the raw XML |
| `Selection` | What the user has enabled: subjects, lectures (+ ★ required), groups, reclassifications. Keyed by `Subject.code`. | yes |
| `Prefs` | What a good week looks like: days off, sliders, day window, lunch, seed, variety, and `tuning`. | yes |

```ts
interface SubjectSelection {
  enabled: boolean;
  lectures: Record<string, { enabled: boolean; required: boolean }>;  // ★ = required
  seminars: Record<string, boolean>;
  reclassified: Record<string, boolean>;   // group treated as a lecture — see below
  pinned: Record<string, boolean>;         // the group the user chose — at most one per subject
}
```

### Selection semantics

- **Subject disabled** → it contributes nothing at all.
- **Lecture disabled** → never shown, never considered.
- **Lecture ★ required** → pins its day: a day-off request touching it is *blocked* in the UI
  with the reason named, and it is never dropped by the solver.
- **Lecture enabled, not ★** → the solver may drop it, but only to satisfy a day off, at
  `droppedLecturePerEvent` points each.
- **A subject with groups** → the solver picks **exactly one enabled group**.
- **All of a subject's groups disabled** → "lecture only, no seminar", shown with a badge.
  This is a legitimate outcome, never an infeasible instance, and it is what makes "deselect a
  group so something else can use that space" work naturally.
- **A group reclassified** (`reclassify.ts`) → treated as lecture-like: a demo session that is
  really a lecture in disguise. It leaves the subject's mutually-exclusive group choice, is
  attended whenever it is enabled, and is dropped by a day off exactly like a non-★ lecture.
  `asLecture()` is a shallow clone with `kind: 'lecture'`, so the parsed timetable other views
  read stays untouched.
- **A group pinned** → the user's *choice*, where `seminars` is only permission. `seminars` says
  which groups the solver may pick from; `pinned` says which one it must. At most one per
  subject — pinning a second replaces the first — and a pinned subject contributes **no decision
  variable**: it is fixed input, and joins the forward-checking list so every other subject
  prunes against it ([§9](#9-the-solver)).
  It stays a **seminar**, unlike a reclassified group: it is still the subject's group, so a
  collision it causes is a seminar collision and is scored as one.
  Three things un-pin it outright, because each makes the pin a statement about nothing:
  switching the group off, filtering it away with a teacher chip, reclassifying it. A **hard
  constraint does not** — a day off or the lunch block overrules the pin for that solve, and
  `analyzePins` reports it, but the pin survives so it returns when the constraint lifts.

### Results

```ts
interface Assignment { seminarChoice: Record<string, string | null>;   // Subject.code -> event id
                       droppedLectures: Set<string> }
interface Solution   { assignment; events: CourseEvent[]; overlaps: Overlap[]; score: Score }
interface Score      { total: number; terms: ScoreTerm[] }             // lower is better
interface SolveResult{ solutions: Solution[];        // best-first, <= topK, never empty
                       provenOptimal: boolean;
                       variety: VarietyPick;         // which rung the seed put forward, and its cost
                       interchangeable: InterchangeableGroup[];
                       variants: Solution[][];       // per rung: other labellings of the same week
                       diagnostics: SolveDiagnostics }
interface SolveDiagnostics { elapsedMs: number;      // wall clock inside solve(), not the debounce
                       nodesVisited: number;         // DFS nodes visited
                       fallbackIterations: number }   // >0 only once the node budget was exceeded
```

---

## 5. How a solve happens

```
  XML text ──parseTimetable──▶ Timetable ──buildDefaultSelection──▶ Selection
                                   │                                    │
                                   └──────────────┬─────────────────────┘
                                                  │  + Prefs
                    ┌─────────────────────────────┼───────────────────────────────┐
                    │ main thread (useMemo)       │        worker (debounced 150ms)│
                    ▼                             ▼                                │
        analyzeAllDaysOff  findLectureConflicts   solve()                           │
        analyzeLunch       analyzePins              │                               │
                    │                               ├─ deriveDroppedLectures        │
                    │                               ├─ derivePinnedGroups           │
                    │                               ├─ fixedLectures (+ pinned)     │
                    │                               ├─ buildVariables  (hard filter,│
                    │                               │    collapse, forward check)   │
                    │                               ├─ DFS + branch & bound ──▶ pool│
                    │                               ├─ selectDiverse / collectVariants
                    │                               └─ pickVariety                  │
                    ▼                                            │                  │
              diagnostics panel                                  ▼                  │
                                                            SolveResult ────────────┘
                                                                 │
                                          week grid · alternatives strip · score breakdown
```

Two independent paths run off the same `(Timetable, Selection, Prefs)`:

- **Analysis** (`analysis.ts`) is synchronous, on the main thread, memoised. It is *pre-flight*:
  it answers "what would happen if you turned Tuesday off?" against the current selection,
  independently of whether Tuesday is off yet, so the UI can explain a toggle before it is
  flipped. It produces blockers (★ lectures pinning a day), dropped-lecture notes, dead-subject
  warnings, lunch overlaps, and lecture↔lecture conflicts.
- **Solving** (`solver.ts`) runs in the worker and produces the ranked schedules.

---

## 6. Module map

```
src/
  main.tsx  App.tsx                  three-pane shell
  domain/                            pure TypeScript — no React, no DOM beyond DOMParser
    types.ts          the model above, plus Prefs / Tuning / Selection / Solution
    format.ts         minutes <-> "HH:MM", DAY_ORDER, DAY_LABELS, describeSlots/Teachers/Rooms
    parseTimetable.ts XML -> Timetable; note resolution, dedupe, kod classification
    parity.ts         fortnightly seminars: note parsing, coincidence predicate, week views
    overlap.ts        interval overlap, parity-aware; lecture-lecture vs seminar classification
    lunch.ts          effective per-day lunch window; slot-overlaps-lunch predicate
    reclassify.ts     asLecture(): treat a seminar group as lecture-like
    analysis.ts       pre-flight: day-off blockers/drops/dead subjects, lunch notes, clashes
    score.ts          the objective, per-term breakdown, DEFAULT_TUNING, two-week averaging
    shape.ts          week-shape identity: dayLoadKey, blockShapeKey, the <hodiny> time snap
    switching.ts      what swapping one group would cost; the ghost tiers; what pins cost
    variants.ts       the other labellings a deduped rung stands for, and what differs
    solver.ts         domain construction, DFS + MRV + forward checking + branch & bound, top-K
    solver.worker.ts  the worker wrapper; answers SolveRequest with SolveResponse, relaying
                      throttled SolveProgress messages while a heavy solve is still running
    variety.ts        tolerance band, day affinity, shape-diverse selection, the presented pick
    random.ts         FNV-1a hash, mulberry32, seeded draws, seed minting, day rankings
    presets.ts        DEFAULT_PREFS and the four preset bundles
    teacherFilter.ts  the teacher-chip click rule (first click exclusive, the rest additive)
    __tests__/        vitest; `sample.ts` reads public/podzim23-timetable.xml as the fixture
  state/
    schedulerStore.tsx  useReducer + Context, localStorage, worker orchestration
  components/
    FileDrop.tsx  ThemeToggle.tsx
    sidebar/   SubjectList  SubjectCard  TeacherChips  UnscheduledTray
    prefs/     PreferencePanel  DayOffToggles  LunchBreak  PresetBar  VarietyControls  AdvancedPanel
    grid/      WeekGrid  HourRuler  DayRow  EventBlock  Legend  gridTypes
    results/   AlternativesBar  ShapeVariants  ScoreBreakdown  PinStatus  DiagnosticsPanel  GapExplainer
               VarietyExplainer  VarietyStatus  SolvePerf
  styles/      theme.css (tokens, light + dark)  app.css
```

Dependencies are deliberately minimal: `react` and `react-dom` at runtime; `vite`,
`typescript`, `vitest` and `jsdom` in development. **No XML library** — the parser uses the
same native `DOMParser` in the browser and under jsdom. **No state-management library** —
`useReducer` + Context is enough.

---

## 7. Constraints vs. preferences

Every control belongs to exactly one of three classes, and knowing which is how you predict
what a change will do.

| Control | Class | Mechanism |
| --- | --- | --- |
| Day off | **hard** | Groups touching the day are removed from the domain before search. Non-★ lectures that day are dropped (a scored cost); a ★ lecture *blocks* the toggle instead. |
| Lunch block (opt-in) | **hard** | Groups whose slot touches that day's effective window are removed from the domain. Per-day override or opt-out. Has no `WEIGHTS` entry — it is not a scored term at all. |
| Group / lecture / subject selection | **hard** | Narrows the domain directly. A teacher filter is expressed this way, not as a soft weight, so it is guaranteed to be honoured. |
| Compactness, Gaps, Break shape, Day window, Max classes/day | **soft** | Weighted terms in the objective ([§8](#8-the-objective-function)). |
| Barely-used days | **soft, always on** | Fades out toward full spread; never user-disabled. |
| Variety | **post-hoc** | Re-ranks within a tolerance band after the search. Never a term. |
| ★ required lecture | **UI gate** | Blocks a day-off request in `analysis.ts`; the solver never sees a required lecture as droppable. |
| Lecture ↔ lecture overlap | **informational** | Shaded and badged. Not scored, does not influence any choice. |

**A dead subject is a trade-off, not a failure.** If a day off or a lunch block leaves a
subject with no usable group, that subject falls back to "no seminar chosen" and the situation
is *reported* — "Tuesday off leaves Intro to Quantum Programming with no usable seminar (01 is
Tue 16:00)" — with one-click fixes, rather than the request being refused or silently mangled.

---

## 8. The objective function

[`src/domain/score.ts`](../src/domain/score.ts). One number per candidate schedule, **lower is
better**, summed from seven independent non-negative terms: two priority terms and five comfort
terms. Every term appears in the on-screen breakdown, so nothing is a black box.

| Term (`ScoreTermKey`) | Measures | Default weight |
| --- | --- | --- |
| `seminarCollision` | overlapping pairs where at least one side is a seminar | 100 000 / pair |
| `droppedLecture` | non-★ lectures dropped to honour a day off | 2 000 / lecture |
| `compactness` | cram: days used · slider. spread: unused weekdays, then load variance | 30 / day, 30 / unused weekday, 0.0005 / min² |
| `sparseDay` | how far each used day falls short of a full 4 h of class | up to 200 / day |
| `gaps` | chargeable dead time, shaped by Break shape | 3 / badness-minute, cap 120 |
| `dayWindow` | minutes scheduled outside the requested start/end | 4 / minute |
| `maxPerDay` | classes beyond the optional daily cap | 150 / class |

The **weight tiers are the design**, not tuning noise: one collision (100 000) outweighs every
comfort term combined, and one dropped lecture (2 000) outweighs comfort but never a collision.
So the solver trades comfort for comfort only — and, because the collision weight dwarfs
everything, a single stray collision usually prunes an entire subtree ([§9](#9-the-solver)).

Lecture↔lecture overlaps are **not scored at all**. They are a fact of the export.

### Dead time: the curve

The first `gapFreeMinutes` (default 30) of **any** gap are free. MUNI teaching hours run
:00–:50, so consecutive classes always show a ten-minute changeover; charging for those made a
fully packed day look riddled with holes — on a real export, 74 % of the total penalty was
changeovers. Reading `<hodiny>` to detect adjacency was rejected (a subject scheduled off the
hour grid would slip through), so the curve simply starts at 30 minutes. Longer gaps are
*measured* from there, not exempted: a 90-minute gap scores as an hour of dead time.

```
d = max(0, m − gapFreeMinutes)                             chargeable minutes
badness(m) = gapBadnessCap · (1 − e^(−(d / gapScaleMinutes)^p))
p = gapExponent(gapShape) ∈ [0.5, 2.5], geometric so the slider midpoint is neutral
cost = Σ badness · prefs.gaps · gapWeight
```

Two sliders, because "how much do I mind dead time?" and "what shape should it take?" are
independent questions and neither can answer the other:

- **Gaps** is a *pure scalar* on the whole term. At 0 it vanishes (and Break shape is disabled
  in the UI). Multiplying every gap cost by one number can never change which of two gap
  arrangements wins — which is exactly why fragmentation needed its own control.
- **Break shape** bends the curve via `p` only, leaving the cap and scale alone, so the curve
  stays **monotonically non-decreasing in length at every setting**. A low exponent is steep
  from the start of the chargeable range, so splitting pays the entry cost repeatedly and dead
  time consolidates; a high exponent is flat near the origin, so short breathers stay cheap and
  the solver scatters them.

Two consequences worth knowing: the free window is **per gap**, so three 1-hour breaks carry 30
chargeable minutes each against one 3-hour break's 150 — from the Break-shape midpoint upward,
splitting wins at that scale. And because a single gap is capped, genuinely long stretches
consolidate at *every* setting. There is no time-of-day exemption anywhere in the score; only
length matters. `GapExplainer.tsx` plots the live curve and worked comparisons, because
convexity cannot be eyeballed.

### Barely-used days

Compactness alone counted only *days used*, at 30 points each and only on the cram side — so a
day holding one seminar cost less than a short gap, and nothing at all at the neutral default.
The solver would strand a lone group on its own day to dodge a few minutes of gap elsewhere.

`sparseDayTerm` charges the **overhead of showing up** rather than the day: a day carrying
`sparseDayFullMinutes` (4 h) or more has earned the trip and costs nothing; below that the
shortfall is charged pro rata up to `sparseDayWeight` (200). The ramp is continuous so the
solver cannot perch exactly on a threshold. It is on by default because "don't make me come in
for one class" is near-universal rather than a taste. Spread is the one preference that
genuinely contradicts it, so the charge fades linearly as compactness goes negative and is zero
at full spread; it does **not** fade on the cram side, which wants full days too.

### Two weeks, when anything is fortnightly

Once any chosen group meets only every other week, a single canvas is a lie. `scoreResolved`
therefore measures the five comfort terms over the **odd week** and the **even week**
separately and averages them term by term, while the per-pair terms (collisions, dropped
lectures) are counted once. Guarded by `hasParity`, so a timetable with nothing fortnightly
takes the identical single-week path it always did.

The averaging exists to *remove a false incentive*, not to encourage stacking. On one canvas an
odd/even pair sharing an hour reads as a single 220-minute day and collects ~200 points of
sparse-day credit it has not earned — the student attends one 110-minute class per week.
Measured week by week the phantom bonus disappears, and stacking wins only where it genuinely
saves a trip: when it hides a fortnightly class inside a day already committed to that same
week. See [§14](#14-decisions-and-rejected-alternatives) for the levers tried instead and why
none of them can work.

### Tuning

Every constant above lives in `prefs.tuning` (`Tuning` in `types.ts`, defaults in
`DEFAULT_TUNING`), not as module constants, and `AdvancedPanel.tsx` exposes all of them grouped
by term with their defaults shown and modified ones flagged. Two things this must keep right:

- **Rule 4**: the solver's bound reads the same values, so editing `seminarCollisionPerPair` or
  `droppedLecturePerEvent` genuinely changes what the search will consider. The panel says so.
- **Hydration merges `tuning` one level deeper** than the rest of prefs, so state persisted
  before a knob existed doesn't leave that knob `undefined` and NaN its way through the score.
  Inputs are clamped to each field's min/max, an emptied box is ignored rather than parsed as
  `NaN`, and `gapScaleMinutes` is floored at 1 inside `gapBadness` so a zero can't blow up the
  curve.

---

## 9. The solver

[`src/domain/solver.ts`](../src/domain/solver.ts). `solve(timetable, selection, prefs, options)`
→ `SolveResult`. Defaults: `topK = 10`, `nodeBudget = 2_000_000`.

### Decision variables

**One variable per enabled subject that has seminar groups**, whose value is which group (or
`null`, meaning no seminar). That is the whole search space. Everything else is resolved before
it starts:

- ★ lectures, subjects without groups, reclassified groups and **pinned groups** are **fixed
  input**. A pinned group is additionally added to the forward-checking list, so every other
  subject can prune against it before the search begins.
- Non-★ lecture drops are **derived, not searched** (`deriveDroppedLectures`): they are only
  ever exercised to satisfy a day off, so searching a binary per lecture would double the space
  to no purpose.

### Domain construction (`buildVariables`) — everything constant, done once

1. **Hard filtering.** Drop groups touching a day off or their day's lunch window.
2. **Never an empty domain.** No survivor → the single value `null` ("lecture only").
3. **Group collapsing.** Groups sharing an exact `slotSignature` — every slot's
   `day:start-end[:parity]`, sorted — are interchangeable by construction, because the score
   never looks at who teaches a group. All but one representative are folded out.
   **Parity belongs in that signature**: an odd-week group and its even-week twin occupy the
   same hour but collide with different things and are lived in different weeks. Keying on
   day/time alone collapsed 29 of podzim2022's 49 collapsed sets across parity and hid half of
   `IB015`'s, `PB154`'s and `VB035`'s groups from the search entirely.
   The survivor is drawn with `pickFrom(members, seed, code, signature)` — see
   [§10](#10-variation-across-a-cohort).
4. **Hoisted forward checking.** A value colliding with a *fixed* lecture of another subject is
   dropped whenever the same variable has a clean alternative — a clean option strictly
   dominates a colliding one there, whatever the rest of the search does, since the collision
   penalty alone outweighs every comfort difference. On a wipe-out, do **not** fail: keep the
   colliding options with their heavy penalty (rule 1).
5. **Value ordering (LCV-ish).** Ascending fixed-collision count, so the DFS finds a strong
   incumbent — and starts pruning — early.
6. **Variable ordering (MRV).** Fewest surviving options first.

### Search

Exhaustive depth-first over the variables, with:

- **Branch and bound.** Every term is non-negative (rule 5) and a subject's collision count can
  only grow as more variables are assigned, so
  `collisionsSoFar · seminarCollisionPerPair + droppedLectureCost`
  is an **admissible lower bound** on any completion from the current node. Once the pool is
  full, a branch whose bound already exceeds the worst kept (plus the variety tolerance) is
  skipped outright.
- **Bounded top-K** with an early-exit guard (`insertRanked`), so a candidate that provably
  can't make the cut is never pushed, sorted or truncated.
- **Deterministic ordering** (`makeCompareSolutions`): score, then earliest finish, then the
  seed's own jitter, with `localeCompare` as an absolute backstop so the ordering stays total
  under a hash collision.

### Scale

| Selection | Raw combinations | Result |
| --- | --- | --- |
| Bundled podzim23 export | 23 250 | proven optimal, milliseconds |
| Heavy real semester (5 subjects, 15–45 groups each) | ~10⁷ before collapsing | proven optimal, well under a second |
| `IB015+PB154+VB035` (podzim2022, fortnightly) | 12 180 collision-free | proven optimal, ~83 ms |

Branch-and-bound plus group collapsing typically cut nodes actually visited by several orders
of magnitude. The **node budget** (2 M) guards pathological inputs with no exploitable
structure: if exceeded, the solver falls back to randomised-restart hill climbing (seeded, so
still reproducible; ~2 % restart probability) and the result is labelled **"best found — not
proven optimal"** via `provenOptimal: false` rather than claiming something it can't prove.

**Diagnosing a slow solve.** `SolveDiagnostics` (`elapsedMs`, `nodesVisited`,
`fallbackIterations`) rides along on every `SolveResult`, and `SolvePerf.tsx` renders it as a
small receipt under the Alternatives heading — real numbers, not a vibe, for a report of "this
feels slow" to be checked against. While the search is still running, `solve()`'s `onProgress`
option samples every 4096 nodes; `solver.worker.ts` throttles that to roughly 10/second and
relays it as a `SolveProgress` message, which `schedulerStore` turns into a live timer and
nodes/s rate next to an *indeterminate* bar. Indeterminate is deliberate: branch-and-bound
prunes unevenly, so there is no honest total node count to show percent-complete against until
the search is already done — a bar that pretended otherwise would be lying about how much work
is left.

### What fills the ten rungs (`selectDiverse`)

The top-K list the search keeps is **not** what the strip shows. Un-collapsing fortnightly twins
left far more equal-scoring solutions than there are perceptibly different weeks — 1 404
combinations tie at the optimum on podzim2022 under neutral preferences — so the strict top ten
was routinely ten spellings of one week: the same fixed lectures, one seminar pair moved. The
search therefore keeps a pool of `topK × POOL_FACTOR` (4) and `selectDiverse` picks the ten,
**for every user, at every Variety setting** — a strip nobody can tell apart is useless whether
or not the slider is up.

It fills the strip in passes, one per key, coarse to fine ([`shape.ts`](../src/domain/shape.ts)):

| pass | key | identity | distinct in a real top ten |
| --- | --- | --- | --- |
| 1 | `dayLoadKey` | day → total class minutes | 3–6 |
| 2 | `blockShapeKey` | multiset of `day:start-end[:parity]` blocks, **labels excluded** | 9–10 |
| 3 | — | leftovers, best first | — |

Neither key works alone: `dayLoadKey` merges a Monday-morning week with a Monday-afternoon one
and would leave rungs empty; `blockShapeKey` is nearly as fine as the exact assignment and would
change nothing. Together they give "here are your genuinely different weeks" followed by finer
variations.

**Excluding labels is exact, not approximate.** Every score term reads only `day`/`start`/`end`
and never subject identity ([§8](#8-the-objective-function)), so two assignments with the same
block multiset score identically **by construction** — measured at 0.000000 spread across three
real selections, and pinned by a test in `shape.test.ts`. A permutation (two subjects trading
slots) is therefore one week, not two; 12–35 % of shapes on real selections contain one.

**Times are snapped to the export's own `<hodiny>` grid** before keying. `CORE033` runs
St 14:00–15:40 next to `MA018` at 14:00–15:50 — a university-wide course from another faculty,
ten minutes shorter — and those are the same week to a human. Fixed-width rounding cannot express
that, because two times ten minutes apart can straddle a bucket edge (at 15 min, 15:37 → 15:30
and 15:47 → 15:45); the declared teaching grid has no edge to straddle, needs no arbitrary
constant, and degrades safely for a slot far from any row. **Snapped times are display keys only
and never reach `scoreResolved`** — those ten minutes are real class time and the `sparseDay` and
`gaps` terms must keep charging for them.

Three properties survive the dedupe, and are what keep the strip honest: **#1 is still the strict
optimum**, the list is **still sorted by real score** (rule 12), and the representative of each
class is **its best-scoring member** — free for an exact block shape, but load-bearing once times
are snapped, since 15:40 and 15:50 share a key and do not share a score. Sorting the pool by
`compare` before the passes is what guarantees it.

`AlternativesBar` prints the day set on each rung ("Po Út Pá"), since rank and score alone cannot
distinguish ten rungs that all read "55". The day set cannot be the whole story either — on
podzim2022 with everything enabled all ten rungs read "Po Út St Čt", because they are backfilled
by `blockShapeKey` and use the same days for the same minutes — so the hover carries each day's
load *and start times*, which differs on every rung by construction.

### …and what a rung hides (`variants.ts`)

Deduping by shape is what made the strip readable and is also what made everything inside a
shape invisible. Most of that is nothing anyone needs, but one kind is news: the **other
labellings of the same week**. Same blocks on the grid, provably the same score, a different
subject at 8am. `collectVariants` keeps the collapsed pool members instead of discarding them —
the same spirit as `interchangeable`, which records what the *search* collapsed — and
`ShapeVariants` offers them under the strip. Picking one is a **jump to a sibling solution, not
an edit**: the whole assignment applies at once, so it needs no state and cannot leave a swap
half-done.

Bounded by the pool, so an empty list means "none among the candidates kept", not "none".
Measured on the real exports (five subjects, neutral preferences): 7 of 10 rungs on podzim22
hide a swap — one of them a five-subject cycle — 4 of 10 on podzim23, none on podzim24.

### What a switch costs (`switching.ts`)

The grid draws every enabled-but-unchosen group as a faint **ghost** strip. `switchCosts` prices
each: resolve the same assignment with that one value replaced, score it, subtract. Deliberately
**not a solve** — re-solving with a group forced answers "what is the best week containing this?",
a different and far costlier question than "what happens to the week I am looking at". Computed
once per solve in `App` (two surfaces need it), then each ghost is ranked `free` / `costly` /
`blocked` so a row of forty strips is readable, with the exact number on hover.

The same numbers price the user's pins. `pinRelief` asks whether a pinned subject's own siblings
hold something better right now — a true **lower bound** on what un-pinning would recover, since
freeing the subject also lets everything else move, hence the "at least" in the UI.

The exact figure needs a **second full search**, and that search is not cheaper than the first:
measured side by side on podzim22, a `topK: 1` baseline came back at 14.8 s against the real
solve's 14.6 s, because the bound is collision-dominated and the comfort terms prune nothing
extra. (Both figures are from vitest on a shared CI container — the ratio is the point, not the
absolute numbers; the same solve is ~3 s in a browser on a laptop.) So showing the exact cost
roughly **doubles every solve while any pin is set**. At laptop speed that is 3 s becoming 6 s,
which is a real trade rather than an obvious one — worth revisiting if the search gets faster,
or if the exact number turns out to matter more than the wait.

---

## 10. Variation across a cohort

Up to four hundred students in a first semester take identical subjects. A deterministic
optimizer computes the same best answer for all of them — correctly — and then four hundred
people register for the same group. It has no reason to prefer one equally-good answer over
another. The **seed** gives it one.

`prefs.seed` is minted once per browser, persisted, and editable (two students can share one on
purpose). Every draw in the solver is a pure function of it (rule 7). It survives *Reset
preferences*, `CLEAR` and `LOAD_TIMETABLE` — none of those should silently move somebody into a
different seminar group — and `DEFAULT_PREFS.seed` is deliberately **blank** so no seed is ever
shared by everyone who hasn't touched the control; the store mints a real one, including for
returning visitors whose persisted prefs predate the feature. Mechanics in `random.ts` (FNV-1a
+ mulberry32, an unambiguous alphabet with no `O/0` or `I/1/L` because seeds get read aloud).

Three sources of sameness. **Two are free** — they cost zero points and are always on:

1. **Interchangeable representatives.** `buildVariables` used to keep the lowest id, which is
   how an entire year ended up in group 01 of the same lab. Drawing the representative from the
   seed instead costs nothing (they score identically) and spreads the year across the parallel
   groups the faculty opened precisely to absorb it. Keyed on the signature rather than call
   order, so it is stable within a solve — otherwise one week could appear twice in the strip
   under two group numbers.
2. **Tie-breaking.** The third sort key was lexicographic on group ids — not a preference,
   just the same systematic bias. It is now seeded, behind score and finish time, which are
   real preferences.

**The third is not free**, and the app says so. A Monday-heavy week is not a tie: lectures are
anchored there, and piling seminars onto a day you are already on campus for genuinely scores
better. The **Variety slider** (`prefs.variety`, 0..1, default 0) buys a different week with
real points:

- **The search runs untouched** (rule 8); `variety.ts` re-ranks afterwards within a band of
  `variety × varietyToleranceMax` (default 60 — ordered far below `droppedLecturePerEvent` at
  2 000 and `seminarCollisionPerPair` at 100 000, so variation can never buy either).
- **The band has to survive the search first.** The internal pool is `topK × POOL_FACTOR` (4)
  for everyone — the strip's own shape dedupe needs the same headroom — and with variety on the
  bound is additionally relaxed by the tolerance, otherwise the search prunes away exactly the
  near-optimal-but-different branches the feature wants. `selectDiverse` then trims to `topK`
  preferring distinct week *shapes* (see [§9](#9-the-solver)), because forty raw candidates are
  routinely forty spellings of one Monday week.
- **Day rankings, not plain jitter.** Each seed gets a uniformly random ranking of Mon–Fri
  (`dayAffinity`); the band is ranked by minute-weighted affinity mismatch plus a small jitter
  tiebreak. Jitter alone is weak when the whole band leans Monday; a per-student ranking is what
  actually spreads a cohort, and its marginal distribution is uniform by construction.
- **Present, don't reorder** (rule 12). `variety.index` marks a rung; `variety.cost` is the
  exact gap to rank 1, printed on screen.

`SolveResult.interchangeable` reports the collapsed sets so the UI can state the available
headroom — without it, a student whose subjects each run a single group reads "nothing changed"
as a bug rather than as a timetable with nothing to spread across. `interchangeableFor` narrows
that list to sets that actually shaped the week on screen, since a representative can still be
dropped by forward checking.

**Limits, stated in the UI as well as here:** no coordination between users (this stops the tool
*amplifying* concentration; it does not allocate capacity, which would need a server that knows
who has booked what), no spreading where the timetable offers no parallel groups, and
registration order still decides the outcome.

---

## 11. State, persistence and the worker

[`src/state/schedulerStore.tsx`](../src/state/schedulerStore.tsx) — `useReducer` + Context, one
provider, `useScheduler()` for consumers.

**State**: `{ xml, fileName, timetable, selection, prefs }`. `timetable` is derived from `xml`
and not persisted directly; everything else goes to `localStorage` under
`schedule-optimizer:v1` on every change, so reopening the app restores the exact working state
including the last-loaded export.

**Actions** are all in one `Action` union — load, preference and tuning setters, preset apply,
the selection toggles, seed set/reroll, resets, clear. Two rules they all follow: the reducer is
pure and total (an unknown target returns state unchanged rather than throwing), and **the seed
is preserved** across `RESET_PREFS`, `CLEAR` and `LOAD_TIMETABLE` via `freshPrefs(state.prefs.seed)`.

**Hydration** (`hydrate`) is where compatibility with older persisted state lives, and each
clause is there for a reason:

- Corrupt or unparseable storage → start clean rather than crash.
- `prefs` shallow-merged onto `DEFAULT_PREFS`, so a preference added since the user's last visit
  isn't `undefined`.
- `tuning` merged **one level deeper** onto `DEFAULT_TUNING` (see [§8](#8-the-objective-function)).
- `seed` cannot be defaulted like the rest — falling back to the shared blank would put every
  returning visitor on identical "random" choices — so a real one is minted.
- `selection[code].reclassified` and `.pinned` default to `{}` for state saved before those
  features existed (`migrateSelection`).

**The worker.** `solver.worker.ts` is a thin wrapper: it answers whatever it is asked, in order,
and knows nothing about cancellation. The store handles that:

- **Debounce 150 ms**, so a slider drag or a burst of toggles collapses into one solve.
- **Monotonic `requestId`**; a response whose id isn't current is dropped, so a stale in-flight
  result can never overwrite a newer one.
- `isSolving` is exposed while a solve is pending, and the previous result stays on screen
  meanwhile rather than flashing blank.
- `solveStartedAt` is set only once the debounce clears and the worker is actually dispatched —
  not when `isSolving` first flips true — so a live elapsed timer times the search, not the
  wait for typing to settle. `solveProgress` carries the latest `SolveProgress` sample and is
  cleared at the start of every solve, both consumed by `SolvePerf` ([§9](#9-the-solver)).
- **Synchronous fallback** via dynamic `import()` where `Worker` is undefined. It blocks this
  thread for the duration, so there is no live progress to show — only the receipt once it
  returns.

---

## 12. The interface

Three panes: sidebar, preferences + results, week grid.

**Sidebar** — the file drop zone and the *Load podzim23* / *Load podzim22* buttons, then one
collapsible card per subject: subject checkbox, code, name; a **Lecture** row (checkbox, ★
toggle, day/time/teacher) marked as *fixed, not chosen*; the **seminar group** rows, presented
as the things you actually pick between; **teacher chips** sharing a row with that subject's own
**Reset groups** button. `<nezname>` items sit in a tray at the bottom, listed, never scheduled.

The teacher-chip click rule (`teacherFilter.ts`, pure and unit-tested) is asymmetric on purpose:
the **first** click out of the unfiltered state is *exclusive* — keep that teacher's groups,
drop the rest — and **every click after it adds**. Narrowing to one teacher is then one click
rather than clicking away everybody else, while "X's and Y's, nobody else's" stays a two-click
build-up. Clicking a fully-selected teacher removes them; if that would empty the subject the
filter clears back to unfiltered instead, since an empty subject can't be scheduled and "undo my
filter" is what that click actually means.

**Week grid** — matched to the school system's own geometry: **days are rows** (Po…Pá in a
narrow gutter), **time is columns**, with an hour ruler from `minhod` to `maxhod`. Blocks are
absolutely positioned in their day row; `DayRow` assigns lanes so overlapping blocks stack.
Block anatomy, top to bottom: **code** (small, accent) → **name** → **teachers** → **room(s)**.
Enabled-but-unchosen groups render as thin dashed **ghost** blocks, so it stays visible what the
optimizer passed over. Fortnightly slots are hatched and badged `odd` / `even`.

**Colour encodes the kind of class, never the subject** — subjects are told apart by their text.
Lectures share one subdued bronze/terracotta; seminars share sage/olive, brighter, because they
are what the app decides; a clash shifts a visible step within its own family to burnt sienna,
with a diagonal stripe and a ⚠. A permanent legend states all three. Light theme by default
(warm, earthy, Material You tokens in `theme.css`), dark mode a single `data-theme` attribute
flip, persisted, initialised from `prefers-color-scheme` only on first visit.

**Results** — the alternatives strip (top 10, each with its breakdown, the variety rung marked),
`ScoreBreakdown`, and `DiagnosticsPanel` (blocked days, trade-offs, dropped lectures, remaining
collisions). Two explainers at the bottom of the page are worth knowing about because they run
the *production* functions rather than describing them: `GapExplainer` plots the live dead-time
curve, and `VarietyExplainer` demonstrates the spread by pushing 400 synthetic seeds through
`random.ts`/`variety.ts`. `AdvancedPanel` is the collapsed tuning section.

---

## 13. Tests and fixtures

`npm run test` — **292 tests across 18 files** (vitest + jsdom, so the parser gets the same
native `DOMParser` the browser uses). `npm run build` runs `tsc --noEmit` first.

The suites mirror the domain modules: `parseTimetable`, `overlap`, `parity`, `lunch`,
`analysis`, `score`, `shape`, `switching`, `variants`, `pinning`, `solver`, `variety`, `random`,
`teacherFilter`, `presets`, `format`, plus `fixture.test.ts` pinning the bundled sample's shape
and `state/schedulerStore.test.ts` covering the reducer and the persisted-state migration.
Three kinds of test are load-bearing rather than routine:

- **The brute-force cross-check** in `solver.test.ts` proves the pruned search finds the true
  optimum — including under non-default tuning, which is what protects rule 4.
- **The score-identity property** in `shape.test.ts` pins the invariant the whole strip dedupe
  rests on: two assignments with the same block multiset score identically. Its companion pins
  the opposite for a *snapped* pair, which is why snapping never reaches the score.
- **Synthetic fixtures** cover shapes the real exports happen not to contain (a lecture↔lecture
  collision, a seminar-only subject), so support for them is verified even when no bundled file
  demonstrates it live.

**Fixture data** lives in two places, for a reason worth not undoing: `public/` is copied
verbatim into the build, so only the two exports the app *offers as examples* belong there
(`podzim23-timetable.xml`, the vitest fixture; `podzim22-timetable.xml`, the fortnightly one).
[`fixtures/timetables/`](../fixtures/timetables/) is the test-only corpus, read from disk and
never bundled — see its own README for what each file is *notable for*, which is the price of
admission to that folder.

---

## 14. Decisions and rejected alternatives

The record of what was tried and did not work, kept because each of these looks like an obvious
improvement until you measure it.

**Charging for changeovers.** Scoring every gap from zero made a perfectly packed day look
riddled with dead time: 74 % of the total penalty on a real export was ten-minute corridor
transitions. **Reading `<hodiny>` to detect adjacency** instead of a flat free window was
rejected too — a subject scheduled off the hour grid would slip through it.

**One slider for dead time.** The Gaps slider is a pure scalar, so it can never change which of
two gap *arrangements* wins; fragmentation needed its own control. Reinterpreting Compactness
for it was rejected as well: compactness is a week-level axis that never looks inside a day.

**A lunch exemption inside the gap curve.** Rejected in favour of a separate opt-in hard block.
The score has no time-of-day term at all; only a gap's length matters. If you want lunch
protected, that is a constraint, not a nudge.

**Counting days instead of day overhead.** See [§8](#8-the-objective-function) — a day holding
one seminar cost less than a short gap, and nothing at the neutral default.

**Encouraging or discouraging stacked fortnightly pairs.** Three levers were prototyped against
the real export on `IB015+PB154+VB035` (12 180 collision-free combinations) and all three were
rejected:

| lever | effect on stacked schedules at the optimum |
| --- | --- |
| `gapFreeMinutes: 0` | none (12.1 %, unchanged) — opposite-parity classes are never in the same week, so no gap forms between them at any setting |
| `sparseDayWeight` ×3 | none (12.1 %, unchanged) |
| `sparseDayFullMinutes` 6 h | 10.9 % — slightly *fewer* |
| cram measured on the fortnight's footprint | none — the minimum footprint is identical for stacked and separated arrangements |

The reason none of them can work: where stacking saves no trip, the stacked and separated
arrangements produce **identical per-week day-load profiles** — one 110-minute day in each week
either way, differing only in which weekday it is. No function of the per-week profile can tell
them apart. Of 20 distinct (odd ‖ even) profile pairs across those 12 180 combinations, only 6
contain both stacked and separated combinations; in the other 14 the profiles genuinely differ
and the existing terms already discriminate correctly. So the score prefers stacking exactly
where it hides a fortnightly class inside a day already committed to that week, and is honestly
indifferent elsewhere. **The two-week average is what makes that honesty possible** — it removes
the phantom sparse-day credit, rather than adding an incentive.

**Using room-repeat counts to detect fortnightly slots.** `<mistnost>` repeats once per actual
occurrence, so the count betrays a fortnightly slot — but it cannot say which half, and
`dedupeById` collapses it anyway. Parity comes from the note or not at all (rule 6).

**Stem-matching the Czech parity words.** `\blich\p{L}*` also fires on unrelated words; the
teacher surname "Sudová" is the real case that caught it. The endings are spelled out instead.

**Perturbing the score for variety.** Rejected twice over: it would corrupt the number shown to
the user, and it would invalidate the branch-and-bound bound, which assumes the terms are
exactly what `score.ts` computes.

**Searching a keep/drop binary per lecture.** Dropping is only ever exercised to satisfy a day
off, so it is derived instead — half the variables for no loss.

**Making a day off, a lunch block or a teacher filter into weighted terms.** All three are what
the user *decided*, not what they'd prefer; as weights they could be silently overridden by a
big enough comfort saving. They filter the domain instead.

---

## 15. Known gaps and open work

- **What a pin really costs is a lower bound, not the figure.** `pinRelief` reports the best
  single swap inside the pinned subject, because the exact answer needs a second full search and
  on podzim22 that doubles a 15-second solve. Worth revisiting if the search itself gets faster.
- **The variant list is bounded by the search pool** (`topK × POOL_FACTOR`), so on a timetable
  with hundreds of tied weeks it reports the labellings that survived to the pool rather than
  every one that exists. An empty list means "none among the candidates kept".
- **A heavy fortnightly export is the slowest thing the app does.** podzim2022 with all eight
  subjects enabled is a **~3 s solve on a current laptop**; un-collapsing odd/even twins roughly
  doubled every domain, and the branch-and-bound bound is collision-dominated, so the comfort
  terms prune almost nothing. Not a regression from the strip or pinning work — measured in a
  real browser, same machine, same selection, `master` at 7 964 ms against this work at
  7 972 ms. **Benchmark numbers in this document are worth reading twice**: a shared CI
  container runs this roughly 3× slower than a laptop, and vitest under jsdom slower again, so
  quote a figure only alongside the thing it was compared against.
- **Block-taught sessions are modelled as weekly.** A third cadence exists beyond weekly and
  fortnightly: sessions taught on a handful of named dates (`pouze Pá 4. 10., Pá 18. 10. a Pá
  25. 10.`). The `p947` groups in the podzim24 fixture are 400-minute slots of exactly this
  kind, and the app currently treats each as a 6 h 40 m *weekly* commitment, badly overstating
  them. Unmodelled; noted at the end of
  [`docs/plans/01-distinct-shapes.md`](plans/01-distinct-shapes.md), which found it.
- **Notes that aren't about parity** (overflow rooms for part of a semester, exception dates
  like "kromě 16. 11.") are surfaced on hover and otherwise ignored.
- **The grid draws Mon–Fri only.** `Day` and the parser tolerate `So`/`Ne`, and day-shaped score
  terms would count them, but `WeekGrid` renders the first five days and the day-off toggles
  cover the same five. A weekend slot would therefore be scored but not drawn.
- **No capacity or coordination data**, by design — see [§1](#1-what-the-app-is) and
  [§10](#10-variation-across-a-cohort).

---

## 16. Glossary

The export is Czech; these are the terms that appear in the XML, the code and the sample data.

| Term | Meaning |
| --- | --- |
| `rozvrh` | timetable — the document root |
| `tabulka` | table — the week grid |
| `den` | day. Ids: `Po` Mon, `Út` Tue, `St` Wed, `Čt` Thu, `Pá` Fri, `So` Sat, `Ne` Sun |
| `radek` | row — a *stacking* row inside a day; layout only, no meaning |
| `slot` | one class meeting, with `odcas` (from) / `docas` (to) |
| `akce` | the course edition: `kod`, `nazev` (name), `predmetid` (subject id) |
| `mistnost` / `mistnosti` | room / rooms; `mistnostozn` is the label |
| `ucitel` / `ucitele` | teacher / teachers; `uciteljmeno` is the name |
| `poznamka` / `poznamky` | note / notes — where fortnightly scheduling hides |
| `nezname` | "unknown" — course editions with no scheduled time |
| `minhod` / `maxhod` | the drawn grid's bounds, in minutes from midnight |
| `hodiny` / `hodina` | hours / hour — the ruler rows |
| `liché` / `sudé` | odd / even — the two halves of the fortnight |
| `každé liché pondělí` | "every odd Monday" |
| `kromě` | "except" — an exception date in a note |
| `pouze` | "only" — a block-taught session's date list |
| `podzim` / `jaro` | autumn / spring — the semester in an export's name |
| ★ (required) | a lecture the user must attend; pins its day against a day-off request |
