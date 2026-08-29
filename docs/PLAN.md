# School Schedule Optimizer — Implementation Plan

## Context

The repository `pepo8187/scheduler` is empty (no commits). We are building, from scratch, a
web app that ingests a MUNI IS timetable export (the same XML format as the uploaded
`c3d25f3d-muj.xml`) and computes an optimal personal weekly schedule.

**The heart of the app is choosing seminar groups.** Lectures are not scheduled by the user —
they are simply given, at a fixed time, take it or leave it. Every real decision is: *which
seminar group of each subject do I take?* The user narrows the candidates (e.g. keep only
`LJ601/01` and `LJ601/02` because they like that teacher), and the algorithm returns the best
possible timetable consistent with those choices and the user's preferences.

Doing this by hand is tedious: the export lists every group of every subject as overlapping
blocks in a grid, and picking one group changes what is possible for every other subject.

### Never fail — always return a timetable

A consequence of lectures being givens: **the app never refuses to produce a schedule.**

- **Lecture ↔ lecture overlaps** are facts of the export, not user mistakes. They are rendered
  in a distinct "conflict" shade with a small badge, and that is all. No error, no rejection,
  no penalty — the user already knows they will have to miss one.
- **Seminar ↔ anything overlaps** are what the optimizer exists to avoid. They carry a very
  large score penalty, so a collision-free schedule always wins when one exists. If the user's
  narrowed selection makes collisions unavoidable, the app still returns the least-bad
  schedule and shades the colliding blocks, rather than showing an empty result.

The only hard constraint is a requested day off (see Preferences below), and even that is
explained rather than silently enforced.

### What the input format actually contains (verified against the sample)

Parsed structure of `<rozvrh>`:

- `<minhod>480</minhod>`, `<maxhod>1200</maxhod>` — **structural grid bounds**, not preferences:
  they say the timetable is drawn from 08:00 to 20:00. They define the canvas the week grid is
  painted on and nothing else.
- `<hodiny>` — 12 `<hodina>` rows (`od`/`do`), the hour ruler for rendering.
- `<tabulka>` → `<den id="Po|Út|St|Čt|Pá" rows="N">` → **N `<radek>` rows** → `<slot>` /
  `<break>`. The `radek` rows exist purely to stack *simultaneous* options — parsing must walk
  every `radek`, and the row index carries no meaning beyond layout. `<break>` is ignored.
- `<slot odcas="08:00" docas="09:40">` contains `<mistnosti>` (rooms), `<akce>`
  (`kod`, `nazev`, `predmetid`, `fakulta_url`, `obdobi_url`), `<poznamka id>`, `<ucitele>`.
  **Rooms and teachers are repeated once per teaching week (12 identical copies)** — must be
  de-duplicated by id.
- `<poznamky>` — `id → text` notes with HTML-escaped `<a>` tags and exception dates
  ("kromě 16. 11."). Shown as tooltips; **not modelled by the solver**. These are the source of
  the green ✱ marker in the school system, which flags irregular timing (e.g. one week skipped
  for a state holiday). It has **no bearing on the weekly schedule** — we surface the note text
  on hover and otherwise ignore it entirely.
- `<nezname>` — courses with no scheduled time (state exams, thesis defence). Listed in a
  tray, never scheduled.

Code convention confirmed: `MA012` = lecture, `MA012/03` = seminar group 03 of `MA012`.

The sample's 19 slots yield these subjects, which exercise every shape we must support:

| Subject | Name | Lecture | Seminar groups |
|---|---|---|---|
| `LJ601` | Latina pro nelatináře I | — (none) | 01–06 (Po/St/Čt) |
| `MV008` | Algebra I | Út 08:00–09:50 | 01 only |
| `MA012` | Statistics II | Út 10:00–11:50 | 01–04 |
| `MA010` | Graph Theory | Út 12:00–13:50 | 01, 02 — **both Pá 10:00–11:50** |
| `IA159` | FM for Software Analysis | Út 12:00–13:50 | — |
| `IA012` | Složitost | St 12:00–13:50 | — |
| `PV021` | Neural Networks | Čt 08:00–09:50 | — |

Three properties of this data drive the design and make good test fixtures:

1. `MA010`'s lecture and `IA159`'s lecture are **both Út 12:00–13:50**. This is the
   lecture-collision case: shade both, badge them, carry on.
2. Friday contains *only* the two `MA010` seminar groups, so "Friday off" is achievable — but
   only by giving up Graph Theory's seminar. The app surfaces that trade-off.
3. `LJ601` has six groups and no lecture; `MV008` has exactly one group (a forced choice).

## Decisions already made with the user

- **Stack**: React + Vite + TypeScript.
- **Lecture priority ★**: ON = must attend, so it pins its day (blocks a day-off request).
  OFF = the solver may treat it as skippable to free up a day, and reports what it dropped.
  Deselecting a lecture entirely = never show or consider it.
- **Day-off vs. a required lecture**: block the request, name the blocking lecture, and offer
  one-click fixes (clear its ★ / exclude the subject).
- **Colliding lectures**: shaded differently, never an error.

---

## Preferences — the user-facing control surface

Preferences live in their own always-visible panel above the week grid. Every control
re-solves instantly (the search is milliseconds) so the grid reacts live as sliders move.
Each one maps to a named term in the score, and every term appears in the "why this
schedule" breakdown so nothing is a black box.

### 1. Days off

Five toggles, Mon–Fri. A day switched off is a **hard constraint** — no seminar group that
touches it will be considered.

Because lectures are givens, a day off interacts with them three ways:

- No lecture that day → clean, the day goes fully free.
- A ★ required lecture that day → the toggle is **blocked**, with the reason spelled out:
  *"Friday is blocked by IA012 Složitost (lecture, fixed)"* plus two buttons — *clear its
  priority* / *exclude the subject*.
- A non-★ lecture that day → allowed; the panel notes *"Friday off: dropping PV021 lecture"*
  so the cost is visible.

If a day off leaves a subject with no usable group, that is reported as a trade-off, not a
failure: *"Friday off leaves Graph Theory with no usable seminar (01, 02 are both Fri 10:00)"*
with actions *accept lecture-only* / *exclude subject* / *keep Friday*.

### 2. Compactness — cram vs. spread

One slider, **Spread out ←→ Cram together**, centre = neutral.

- Pushed right: strongly rewards using fewer distinct days. Produces the "three long days,
  four days off" shape.
- Pushed left: rewards distributing classes evenly across the week, penalising days that
  carry far more than the average load. Produces the "a bit every day, home by lunch" shape.

Scores the number of days used plus, on the spread side, the variance of per-day load.

### 3. Gaps — dead time between classes

Slider, **Gaps are fine ←→ No dead time**. Penalises each idle minute between consecutive
classes on the same day. High setting produces back-to-back blocks; low setting lets the
solver use a two-hour hole to buy a better day count. A short lunch allowance (configurable,
default 60 min around midday) is exempt so the optimizer does not eliminate lunch.

### 4. Day window — earliest start / latest end

Two time selects for *when the user wants to be at school*, e.g. "nothing before 10:00,
nothing after 18:00". This is unrelated to `minhod`/`maxhod`, which fix the drawn grid at
08:00–20:00 regardless. Anything scheduled outside the chosen window is penalised **per
minute outside** rather than forbidden — so the preference nudges hard without becoming
unsatisfiable when a lecture is fixed at 08:00.

### 5. Seminar teacher preference

Not a slider — it is expressed by selection. The sidebar shows teacher chips per subject;
clicking a teacher's chip keeps only that teacher's groups enabled. This is the direct
mechanism for "I only want Mr. X's seminars", and it feeds the solver as a narrowed domain
rather than as a soft weight, so it is guaranteed to be honoured.

### 6. Max classes per day (soft cap)

Optional numeric cap, off by default. When set, each class beyond the cap on any day is
penalised. Useful together with "spread" to prevent one monster day.

### 7. Presets

One-click bundles that set the sliders sensibly, as a starting point users then tweak:
**Cram it in** · **Spread evenly** · **Late riser** · **Long weekend** (Friday off + cram).

### Weights and persistence

Each preference contributes `weight × measure` to a single objective. Weights are tuned so
that a seminar collision always outranks any comfort preference, and a dropped ★-less lecture
outranks all comfort preferences but not a collision. The full preference set — plus every
subject/lecture/seminar selection and the last-loaded XML — persists to `localStorage`, so
reopening the app restores the exact working state.

---

## UI / design

Three panes.

**Left sidebar (~320 px)** — file drop zone and a *Load sample* button at the top, then one
collapsible card per subject: subject checkbox, code, name. Inside a card:

- a **Lecture** row — checkbox + ★ priority toggle + day/time/teacher, visually marked as
  *fixed, not chosen*;
- the **Seminar group** rows — checkbox per group, group number, day/time, teacher; these are
  presented as the things the user actually picks between;
- **teacher chips** for bulk-selecting groups by teacher.

`<nezname>` items sit in a tray at the bottom, listed but never scheduled.

**Centre — the week grid.** Matched to the school system's own view (screenshot supplied):

- **Days are rows** (Po, Út, St, Čt, Pá in a narrow left gutter), **time is columns** — an hour
  ruler across the top from `minhod` to `maxhod` (08:00–20:00), labels left-aligned on each
  hour line, thin vertical hour separators, horizontal separators between day rows.
- Blocks are absolutely positioned within their day row; a day row grows into stacked
  sub-rows when blocks overlap (only lecture clashes normally do).
- Block content, top to bottom: **code** (small, accent-coloured) → **name** (larger, primary,
  ellipsis-truncated) → **teachers** (small, muted, comma-joined) → **room(s)** (small, muted).
- Rendered in this app's own warm palette, not the school system's cold blue — see
  *Visual language* below.

**Colour is by kind, not by subject** — which is also what the school system already does: in
the supplied screenshot every `/NN` seminar block (`PV080/11`, `IB005/01`, `IB002/11`,
`M2150/01`) carries a bright blue fill, while every lecture block sits dark. We keep that
logic and make both sides explicitly coloured, since the ask is for obvious separation:

- **All lectures share one colour** — a subdued bronze/terracotta fill with a solid accent
  rule. Subdued because lectures are givens, not choices.
- **All seminars share one other colour** — sage/olive, a distinctly different hue, brighter
  and more saturated, because seminars are the thing the app actually decides.
- **Clashing lectures shift a shade within the lecture family** — same hue, a visible step
  lighter and more saturated, plus a faint diagonal stripe and a small ⚠. It reads as "still a
  lecture, just look here." No error, no rejection.
- A seminar left in a collision (only when the user's narrowing makes it unavoidable) gets the
  equivalent shade step within the seminar family.

Subjects are told apart by their text — code, name, teachers, room, and the group number on
seminar blocks — never by hue. A permanent legend states the two colours and the clash shade.
Unselected candidate groups may be shown as faint outlines in the seminar colour, so it is
visible what the optimizer passed over.

### Visual language — warm, earthy, modern

Deliberately *not* the school system's cold dark blue. **Light is the default theme**, with a
dark-mode toggle in the header (choice persisted, initialised from `prefers-color-scheme` only
on first visit).

**Light theme — Material You, earthy / bronze.** A warm neutral ground rather than white:
sand-tinted background, slightly lighter warm surfaces, soft warm-grey outlines, and deep
warm-brown text. Bronze is the primary accent. Roughly:

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F7F2EC` sand | `#191512` warm near-black |
| `--surface` | `#FFFCF8` | `#241E19` |
| `--surface-alt` | `#EFE6DA` | `#2E2620` |
| `--outline` | `#DCCFC0` | `#3D342C` |
| `--text` | `#3A2E24` | `#F0E7DC` |
| `--text-muted` | `#7A6A5B` | `#B3A392` |
| `--primary` (bronze) | `#8C5E33` | `#E0A96D` |

**Class colours stay within the earth palette**, so the two kinds separate by hue without
breaking the mood:

- **Lectures — bronze/terracotta.** Light: `#EADAC6` fill, `#8C5E33` accent rule and code text.
  Dark: `#3A2B1D` fill, `#E0A96D` accent.
- **Seminars — sage/olive.** Light: `#DCE3D0` fill, `#5F6F52` accent. Dark: `#28311F` fill,
  `#A8C09A` accent. Clearly a different hue from bronze at a glance, still earthy.
- **Clash shade — burnt sienna step** within the lecture family: light `#E8C4A8` fill with
  `#A8542B` accent, dark `#4A2A1A` / `#D97A4E`, plus a faint diagonal stripe and a small ⚠.
  Same family, one visible step over — exactly "a different shade a bit".

**Shape and feel — rounded and modern.** Radius tokens: `--r-lg: 16px` (panels, cards),
`--r-md: 12px` (class blocks, the grid container), `--r-sm: 8px` (inputs, buttons),
`--r-pill: 999px` (teacher chips, preset buttons, toggles). Soft, low-contrast shadows rather
than hard borders; generous padding; a single system font stack with tight, confident type
scale. Sliders, switches and chips follow Material-You proportions (pill tracks, large hit
areas). Every colour is a CSS custom property defined once per theme on `:root` and
`:root[data-theme="dark"]`, so the toggle is a single attribute flip.

**Top / right** — the preferences panel described above, a diagnostics strip (blocked days,
trade-offs, dropped lectures, remaining collisions), and an **alternatives** strip paging
through the top-10 schedules, each with its score breakdown so the ranking is legible.

---

## Architecture

Pure-TypeScript domain layer (no React imports) with React only at the edges, so the parser,
analyzer, and solver are unit-testable headlessly.

```
scheduler/
  package.json  vite.config.ts  tsconfig.json  index.html  README.md  .gitignore
  public/sample-timetable.xml          # the uploaded file, bundled as "Load sample"
  src/
    main.tsx  App.tsx
    styles/theme.css  styles/app.css
    domain/
      types.ts            # Day, Slot, CourseEvent, Subject, Timetable, Prefs, Solution
      parseTimetable.ts   # XML -> Timetable (DOMParser)
      overlap.ts          # interval overlap + conflict classification (lecture/seminar)
      analysis.ts         # pre-flight: day blockers, dead subjects, fixed-lecture conflicts
      score.ts            # objective: one term per preference + breakdown
      solver.ts           # exhaustive DFS w/ MRV + forward checking, top-K results
      presets.ts          # the four preference bundles
      format.ts           # minutes<->"HH:MM", day labels
      __tests__/          # vitest: parser, overlap, analysis, score, solver (+ fixture)
    state/
      schedulerStore.tsx  # useReducer + Context, localStorage persistence
    components/
      FileDrop.tsx
      sidebar/SubjectList.tsx  SubjectCard.tsx  TeacherChips.tsx  UnscheduledTray.tsx
      prefs/PreferencePanel.tsx  DayOffToggles.tsx  PresetBar.tsx
      grid/WeekGrid.tsx  HourRuler.tsx  DayRow.tsx  EventBlock.tsx  Legend.tsx
      ThemeToggle.tsx
      results/AlternativesBar.tsx  ScoreBreakdown.tsx  DiagnosticsPanel.tsx
```

Dependencies stay small: `react`, `react-dom`; dev: `vite`, `@vitejs/plugin-react`,
`typescript`, `vitest`, `jsdom` (so tests get the same native `DOMParser` the browser uses —
no XML library at runtime). State is `useReducer` + Context; no state-management dependency.

## Domain model

```ts
type Day = 'Po' | 'Út' | 'St' | 'Čt' | 'Pá' | 'So' | 'Ne';

interface Slot { day: Day; start: number; end: number;   // minutes from midnight
                 rooms: string[]; teachers: Teacher[]; noteId?: string; note?: string }

interface CourseEvent {          // one enrollable unit
  id: string;                    // "MA012" | "MA012/03"
  subjectCode: string;           // "MA012"
  kind: 'lecture' | 'seminar';
  group?: string;                // "03"
  slots: Slot[];                 // >1 when a group meets several times a week
  teachers: Teacher[];           // de-duplicated union across slots
}

interface Subject { code; name; subjectId; facultyUrl; periodUrl;
                    lectures: CourseEvent[]; seminars: CourseEvent[] }
```

Parsing rules: `kod` matching `^(.+?)/([0-9]+[A-Za-z]?)$` → seminar of `$1`, group `$2`;
otherwise a lecture. Slots sharing a `kod` merge into one `CourseEvent` (all-or-nothing:
picking group `01` means attending *all* its weekly meetings). Times `H:MM`/`HH:MM` →
minutes. Rooms/teachers de-duplicated by id. Unknown or extra day ids are tolerated so a
Saturday export still renders.

## Selection state

Per subject: `enabled`. Per lecture: `enabled` + `required` (★). Per seminar group: `enabled`.

If an enabled subject has seminar groups, the solver picks **exactly one enabled** group. If
the user disables *all* of a subject's groups, that means "lecture only, no seminar" with a
visible badge — never an infeasible instance. This is what makes "deselect a seminar so a
different one gets scheduled in that space" work naturally.

## Solver (`solver.ts`)

Decision variables: one per enabled subject-with-seminars (which group), plus one binary per
enabled non-★ lecture (keep / drop, only ever exercised to satisfy a day off). ★ lectures and
subjects without seminars are fixed input, placed before the search begins.

Exhaustive depth-first search with:

- **upfront domain filtering** — groups touching a day off are removed before search;
- **MRV ordering** — variables with the fewest surviving options first;
- **forward checking** — after each assignment, prune now-conflicting options of the
  remaining variables; on a domain wipe-out, do not fail — fall back to keeping the
  collision-carrying options with their heavy penalty, so a schedule is always returned;
- **bounded top-K** — keep the best 10 complete assignments for the alternatives strip.

The space is tiny (48 combinations for the sample; ~10⁶ worst case for a heavy semester), so
full enumeration yields **proven optimality**. A node budget (~2 M nodes / ~250 ms) guards
pathological inputs; if exceeded, the solver falls back to randomised-restart hill climbing
and the result is labelled *"best found — not proven optimal"* rather than claiming
optimality.

`score.ts` returns a total plus a per-term breakdown — one term per preference section above,
plus collisions and dropped lectures — so every candidate can explain its rank. Deterministic
tie-breakers (earlier finish, then lexicographic group ids) keep results stable across runs.

## Session split — status

**All 8 steps are done and committed**, across two sessions on the same branch. Nothing is
outstanding; this section is now a record of how the work was split, not a to-do list.

Session 1 delivered step 1:

- `docs/PLAN.md` — this document;
- `public/sample-timetable.xml` — the uploaded MUNI IS export, bundled as the "Load sample"
  fixture and used by the tests;
- the Vite + React + TS skeleton: `package.json`, `vite.config.ts` (vitest + jsdom, note it
  imports `defineConfig` from `vitest/config`, not `vite`), `tsconfig.json`, `index.html`
  (with the pre-paint theme script), `src/main.tsx`, a placeholder `src/App.tsx`;
- `src/styles/theme.css` — the full token palette: light and dark, lecture / seminar / clash
  colours, radii, shadows, spacing;
- `src/components/ThemeToggle.tsx` — working dark-mode switch, persisted to `localStorage`;
- `src/domain/__tests__/sample.ts` — `readSampleXml()` / `parseSampleXml()` helpers, resolved
  from `process.cwd()` since `import.meta.url` is an http: URL under jsdom;
- `src/domain/__tests__/fixture.test.ts` — 5 smoke tests pinning the fixture's shape.

Session 2 delivered steps 2–8 in order (see Work order and Verification below), landing the
full domain layer, state store, UI, styling pass, and README on the same branch. Final state:
**66 tests passing**, `npm run build` clean, and the full 9-point verification list below
confirmed against the bundled sample in Chromium (light + dark, 1440px and 1024px). One
finding worth flagging rather than hiding: the bundled sample's `MV008` has exactly one
seminar group and it collides with `MA012`'s lecture, so the fully-enabled default load
shows one real seminar-collision badge rather than a clean week — see the README's *"A real
unavoidable collision"* section. This is the "never fail" design working as intended on real
data, not a defect; verification item 2 below is annotated accordingly.

## Work order

1. Scaffold Vite + React + TS, `tsconfig`, `vitest` (jsdom), `.gitignore`, `README.md`;
   commit the sample XML to `public/sample-timetable.xml`.
2. `domain/types.ts`, `format.ts`, `overlap.ts`, `parseTimetable.ts` + parser tests against the
   real sample (7 subjects, the `LJ601` six-group/lecture-less shape, room and teacher
   de-duplication, `nezname` extraction, the `Út 12:00` lecture pair detected as a conflict).
3. `score.ts` + `analysis.ts` + `presets.ts` with tests for each preference term in isolation
   and for the Friday/`MA010` trade-off.
4. `solver.ts` + tests: known-answer cases, a no-collision-possible case that still returns a
   schedule, and a brute-force cross-check proving the pruned search finds the true optimum.
5. `state/schedulerStore.tsx` — reducer, defaults, localStorage.
6. Sidebar → preference panel + diagnostics → week grid + legend → alternatives strip.
7. Styling pass: days-as-rows / hours-as-columns geometry and the
   code→name→teachers→room block anatomy from the screenshot, but rendered in the warm
   earthy/bronze Material-You light theme with rounded corners and soft shadows; the
   dark-mode toggle and its palette; responsive down to a laptop screen.
8. README: input format, the scoring model, how to run.

## Verification

- `npm run test` — parser / overlap / analysis / score / solver units, including the
  brute-force equivalence check.
- `npm run build` — clean TypeScript build, no errors.
- `npm run dev` driven end-to-end with Playwright/Chromium (pre-installed), loading the
  bundled sample, with screenshots confirming:
  1. all 7 subjects listed with correct lecture/seminar splits;
  2. a default solve produces a seminar-collision-free week **where one is achievable — on the
     bundled sample itself, `MV008`'s single forced group collides with `MA012`'s lecture, so
     the true default shows exactly that one badge; confirmed the app still behaves correctly
     (shaded, badged, ranked as the least-bad option) rather than forcing a false claim**;
  3. the `IA159` / `MA010` lecture pair renders **shaded and badged, with no error**;
  4. narrowing `LJ601` to groups 01 + 02 restricts the result to exactly those;
  5. deselecting `MA012/01`–`/03` forces group `/04` into the result;
  6. **Friday off** surfaces the Graph Theory trade-off rather than a blank result, and
     accepting "lecture only" yields a genuinely Friday-free schedule;
  7. the compactness slider visibly changes the day count between its extremes;
  8. every lecture shares one colour and every seminar the other, with clashing lectures a
     visible shade apart, in a days-as-rows grid whose block anatomy matches the supplied
     screenshot (screenshot + legend review);
  9. the app opens in the warm earthy light theme, and the toggle flips cleanly to dark with
     no unstyled or low-contrast areas (screenshots of both).
- Commit to `claude/school-schedule-optimizer-czj595` and push with `-u origin`.
