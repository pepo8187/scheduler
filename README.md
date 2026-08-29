# Schedule Optimizer

A web app that reads a MUNI IS timetable export and works out the best personal weekly
schedule for you.

Lectures are **givens** — the faculty fixes them and you either attend or you don't. The real
decision, and the whole point of this app, is **which seminar group to take for each subject**.
You narrow the candidates (keep only the groups taught by the teacher you want, drop subjects
you aren't taking), state your preferences, and the optimizer searches the remaining
combinations for the schedule that fits you best.

Full design rationale lives in [`docs/PLAN.md`](docs/PLAN.md); this file is the practical
how-it-works.

## What it does

- **Reads the IS export** — the same XML `<rozvrh>` format the school system produces. Drop a
  file on the sidebar or click **Load sample** to try the bundled `public/sample-timetable.xml`.
- **Lets you prune the options** — deselect a whole subject, an individual lecture, or specific
  seminar groups; mark a lecture ★ required; filter a subject's groups down to one teacher's in
  a click.
- **Optimizes for your preferences** — cram everything into as few days as possible or spread it
  out, take a day off, avoid early mornings and late evenings, minimise dead time between
  classes, cap classes per day. Four presets (*Cram it in*, *Spread evenly*, *Late riser*,
  *Long weekend*) set them all at once as a starting point.
- **Explains itself** — every schedule comes with a full score breakdown, and a day-off toggle
  that would strand a subject explains why and offers one-click fixes (accept lecture-only,
  exclude the subject, or keep the day) instead of silently refusing.
- **Never fails.** Overlapping lectures are a fact of the export, not an error: they're shaded a
  step apart and flagged with a ⚠, never blocked. If narrowing the candidates makes a seminar
  collision unavoidable, the app still returns the least-bad schedule rather than an empty
  result — see *A real unavoidable collision* below for a case that actually happens on load.
- **Shows the top 10**, not just one answer — the alternatives strip lets you page through the
  next-best schedules and see how their score breaks down against the one you're looking at.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # unit tests (vitest + jsdom) — 66 tests across parser/overlap/analysis/score/solver
npm run build    # typecheck + production build
```

Node 22 or newer.

## Reading the input format

The export nests as `<rozvrh>` → `<tabulka>` → `<den>` (a weekday) → `<radek>` (a stacking row,
purely for layout) → `<slot>` (one class meeting). What matters:

| Element | Meaning |
| --- | --- |
| `<minhod>` / `<maxhod>` | Structural grid bounds in minutes — the timetable is drawn 08:00–20:00 |
| `<slot odcas docas>` | Start and end time of a meeting |
| `<akce><kod>` | The class code — see below |
| `<mistnosti>` / `<ucitele>` | Rooms and teachers, repeated once per teaching week (de-duplicated on parse) |
| `<poznamky>` | Notes and irregular-timing dates; shown on hover, ignored by the solver |
| `<nezname>` | Courses with no time (state exams, thesis defence); listed, never scheduled |

The code tells you what kind of class it is:

- `MA012` — a **lecture** of subject `MA012`
- `MA012/03` — **seminar group 03** of subject `MA012`

A subject may have both, only a lecture (`IA012`), or only seminars (`LJ601`, a language
class with six groups and no lecture).

## The scoring model

Every candidate schedule gets one number — lower is better — built from six independent
penalty terms (`src/domain/score.ts`), weighted so more important things always win:

| Term | What it penalises | Weight |
| --- | --- | --- |
| Seminar collisions | Any overlap involving a seminar (seminar↔seminar or seminar↔lecture) | 100,000 per pair |
| Dropped lectures | A non-★ lecture dropped to honour a day off | 2,000 per lecture |
| Compactness | Cram: days used. Spread: unused weekdays first, load-variance as a tiebreak | up to ~30/day |
| Dead time | Idle minutes between classes on the same day, minus the lunch buffer | up to 3/minute |
| Day window | Minutes scheduled outside the requested start/end | 4/minute |
| Max classes/day | Classes beyond the optional daily cap | 150/class |

A seminar collision always outranks a dropped lecture, which always outranks every comfort
term — so the solver only ever trades comfort for comfort, never for a collision. Lecture ↔
lecture overlaps are not scored at all: they're a fact of the export (see below), rendered as
a badge, and never influence which seminar group gets picked.

`src/domain/solver.ts` searches one variable per enabled subject-with-seminars (which group,
or none) via MRV-ordered DFS with forward checking, keeping the best 10 by score. Non-★
lecture drops aren't searched — they're derived directly from which days are off, since that
is the only thing they're ever used for. The search space for a normal semester is tiny (48
combinations for the bundled sample) so this is exhaustive and provably optimal; a node-budget
guard falls back to randomised local search on pathological inputs, and that result is
labelled "best found — not proven optimal" rather than claiming something it can't prove.

### A real unavoidable collision

The bundled sample isn't a clean toy: `MV008` ("Algebra I") has exactly one seminar group,
`MV008/01`, and it meets Tuesday 10:00–11:50 — the same slot as `MA012`'s lecture. Since a
non-★ lecture is only ever dropped to satisfy a day off (never to dodge a collision, per the
plan's own design), this pairing has no collision-free resolution with everything enabled.
Loading the sample as-is therefore shows one real seminar-collision badge out of the box —
which is exactly the "never fail, shade it and move on" behaviour this app is built around,
not a bug. Disabling `MV008` (or accepting the collision) is the user's call, same as any
other trade-off the app surfaces.

## Colour

Colour encodes the *kind* of class, never the subject — subjects are told apart by their text.

- **Lectures** — bronze/terracotta. Subdued, because they are fixed.
- **Seminars** — sage/olive. The thing the optimizer actually chooses.
- **Overlapping lectures** — a burnt-sienna step within the lecture family, plus a ⚠.

Light theme by default (warm, earthy, Material You), with a dark mode toggle in the header.

## Layout

```
docs/PLAN.md                    full implementation plan
public/sample-timetable.xml     bundled example export
src/domain/                     pure TypeScript, no React — unit-testable headlessly
  types.ts                        Day, Slot, CourseEvent, Subject, Timetable, Prefs, Selection, Solution
  parseTimetable.ts                XML -> Timetable
  overlap.ts                       interval overlap + lecture-lecture vs seminar classification
  analysis.ts                      day-off pre-flight: blockers, drops, dead-subject trade-offs
  score.ts                         the objective and its per-term breakdown
  solver.ts                        MRV/forward-checking DFS, top-10, node-budget fallback
  presets.ts                       default prefs + the four one-click bundles
  format.ts                        minutes<->"HH:MM", day labels, slot/teacher/room descriptions
  __tests__/                       vitest: parser, overlap, analysis, score, solver (+ real-sample fixture)
src/state/schedulerStore.tsx    useReducer + Context; persists xml/selection/prefs to localStorage
src/components/
  FileDrop.tsx                     drag/drop + "Load sample"
  sidebar/                         SubjectList, SubjectCard, TeacherChips, UnscheduledTray
  prefs/                           PreferencePanel, DayOffToggles, PresetBar
  grid/                            WeekGrid, HourRuler, DayRow, EventBlock, Legend
  results/                         AlternativesBar, ScoreBreakdown, DiagnosticsPanel
  ThemeToggle.tsx
src/styles/theme.css            every colour, radius and shadow token, light + dark
src/styles/app.css              layout and every component's styling
```
