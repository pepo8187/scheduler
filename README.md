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
  seminar groups; mark a lecture ★ required; filter a subject's groups by teacher — the first
  chip you click keeps only that teacher, each one after it adds another, and a per-subject
  **Reset groups** button puts them all back.
- **Optimizes for your preferences** — cram everything into as few days as possible or spread it
  out, take a day off, avoid early mornings and late evenings, minimise dead time between
  classes — and choose whether that dead time lands in one long break or several short ones —
  cap classes per day. Four presets (*Cram it in*, *Spread evenly*, *Late riser*,
  *Long weekend*) set them all at once as a starting point.
- **Can block out lunch, opt-in** — turn it on, set a time, and no seminar group touching that
  window is ever chosen. Off by default; each of the five weekdays can use the same window,
  a different one (a later lunch on a day with a long morning), or none at all. This is a
  hard constraint like a day off, not a scoring nudge — see *Blocking out lunch* below.
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
npm run test     # unit tests (vitest + jsdom) — 90 tests across parser/overlap/analysis/lunch/score/solver
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
| `<nezname>` | Course editions with no fixed slot (e.g. substitute/make-up sessions); listed, never scheduled |

The code tells you what kind of class it is:

- `IB111` — a **lecture** of subject `IB111`
- `IB111/03` — **seminar group 03** of subject `IB111`

A subject may have both, or only a lecture (`VV028`). The format also allows a subject
with only seminars and no lecture at all — a language class with several groups, say — the
bundled sample just doesn't happen to include one.

## The scoring model

Every candidate schedule gets one number — lower is better — built from six independent
penalty terms (`src/domain/score.ts`), weighted so more important things always win:

| Term | What it penalises | Weight |
| --- | --- | --- |
| Seminar collisions | Any overlap involving a seminar (seminar↔seminar or seminar↔lecture) | 100,000 per pair |
| Dropped lectures | A non-★ lecture dropped to honour a day off | 2,000 per lecture |
| Compactness | Cram: days used. Spread: unused weekdays first, load-variance as a tiebreak | up to ~30/day |
| Barely-used days | How far each day used falls short of a full 4h of class — the overhead of showing up | up to 200/day |
| Dead time | Idle time between classes on the same day past a free 30-minute window, shaped by *Break shape* (see below) | up to 3/capped-minute |
| Day window | Minutes scheduled outside the requested start/end | 4/minute |
| Max classes/day | Classes beyond the optional daily cap | 150/class |

A seminar collision always outranks a dropped lecture, which always outranks every comfort
term — so the solver only ever trades comfort for comfort, never for a collision. Lecture ↔
lecture overlaps are not scored at all: they're a fact of the export (see below), rendered as
a badge, and never influence which seminar group gets picked.

### Dead time starts at 30 minutes

**The first 30 minutes of any gap are free.** Teaching hours in a MUNI export run :00–:50, so
two genuinely back-to-back classes still show a ten-minute changeover — charging for those made
a perfectly packed day look riddled with dead time, and pushed the solver into absurd choices to
avoid phantom gaps. Anything up to half an hour is a walk between buildings, not dead time.
Longer gaps aren't ignored, they're measured from there: a 90-minute gap is scored as an hour of
dead time. The breakdown reports the raw idle minutes *and* how many gaps are actually being
charged, so a zero cost beside a pile of idle minutes reads as intended rather than as a bug.

### Dead time isn't linear

Past the free window, a gap's badness isn't proportional to its length, but it is always
*non-decreasing*: a longer gap is never scored better than a shorter one, and no gap is ever
scored better than none at all. Beyond that, how bad a gap of a given length feels is a matter
of taste, so it's yours to set: **two sliders shape the dead-time curve, and the app plots the
curve they produce.**

- **Gaps** (*Gaps are fine ←→ No dead time*) sets how *tall* the curve is — how much dead
  time costs relative to every other comfort term. At 0 the term vanishes entirely.
- **Break shape** (*One long break ←→ Several short breaks*) *bends* it. This is the
  continuity control: given the same amount of idle time, should it land in one block or be
  split into short breathers?

Bending the curve is what decides fragmentation. Pulled toward *one long break* the curve
climbs steeply from the start of the chargeable range, so every chargeable minute counts
immediately and splitting dead time pays that steep entry cost once per gap — the solver
consolidates. Pulled toward *several short breaks* the curve stays flat for a while and only
bites for longer stretches, so short breathers are close to free and the solver scatters them.

Note the free window interacts with this: each gap gets its own 30 free minutes, so three
1-hour breaks carry only 30 chargeable minutes apiece against a single 3-hour break's 150. From
the midpoint upward that makes splitting win at the 2–3 hour scale; pull *Break shape* toward
*one long break* to consolidate those too. Genuinely long stretches consolidate at every
setting, because a single gap can never cost more than the cap — three 2-hour holes strand you
on campus three times, which beats nobody's idea of a good day. Likewise two classes at
08:00–10:00 and 10:00–12:00 always beat the same two at 08:00–10:00 and 18:00–20:00.

`gapBadness()` (`src/domain/score.ts`) models this as a Weibull CDF over the *chargeable* part
of the gap, rising from zero to a cap of 120 "minutes":

```
d = max(0, m − 30)                     // chargeable minutes
badness(m) = 120 · (1 − e^(−(d/120)^p))      p = gapExponent(gapShape), 0.5 … 2.5
```

`p` is the only thing *Break shape* changes; the cap and the 120-minute scale are fixed, which
is why the curve is monotonic in length and bounded at every setting. The score has no special
exemption for lunchtime or any other time of day. If you specifically want lunch protected,
that's the separate opt-in preference below — not a scoring nudge, but a hard block.

The *How your sliders score dead time* panel plots this live, shades the free window, and —
since convexity is nearly impossible to read off a curve by eye — shows the same idle time split
two ways at your current settings with the arrangement the solver prefers marked.

### The cost of showing up

A day holding one two-hour seminar costs nearly as much to attend as a full one: the trip, the
morning, the day being spoken for. Compactness only ever counted days, at 30 points each and
only when you pushed the slider to cram — so an otherwise-free Friday carrying a single group
was worth less than a coffee break, and at the neutral default it was worth *nothing*. The
solver would strand a lone seminar on its own day to dodge a few minutes of gap elsewhere.

**Barely-used days** charges for that overhead instead of for the day. A day carrying 4 hours
of class or more has earned the trip and costs nothing; below that, the shortfall is charged pro
rata up to 200 points for a nearly empty one. It ramps smoothly rather than snapping at a
threshold, so the solver can't perch exactly on the edge of one.

Unlike compactness this is **on by default** — "don't make me come in for one class" is
near-universal rather than a matter of taste. Spreading out is the one preference that genuinely
contradicts it, since deliberately light days are the whole point, so the charge fades as the
compactness slider moves toward spread and is gone entirely at the extreme.

### Advanced scoring controls

Everything above describes the defaults, and they are argued for rather than guessed — but the
exchange rate between an hour of dead time and a wasted morning is genuinely personal, and no
default settles it for everybody. So **every constant the objective is built from is exposed**,
in a collapsed *Advanced scoring controls* panel at the bottom of the page: the free window and
the shape of the gap curve, what counts as a full day and what an empty one costs, both ends of
compactness, the two linear comfort penalties, and the two priority weights. Each shows its
default, changed ones are marked, and **Reset to defaults** puts them all back.

They live in `prefs.tuning` (`Tuning` in `types.ts`, defaults in `DEFAULT_TUNING` in
`score.ts`), so they persist with the rest of your preferences and flow to the solver worker
like any other preference. The priority weights feed the search's admissible lower bound as well
as the score, so lowering them genuinely changes which schedules the solver will consider —
that's noted in the panel.

### Blocking out lunch

**Block out lunch** (off by default) is a hard constraint, the same kind as a day off, just
scoped to a time window instead of a whole day: turn it on, set a default *From– Until*, and
no seminar group with a slot touching that window on any of the five weekdays is ever chosen
— it's filtered out of the solver's search space before the search even starts
(`src/domain/lunch.ts`, wired into `buildVariables` in `solver.ts`). If narrowing leaves a
subject with no group that survives, that's reported as a "Lunch trade-off" (the same
never-fail spirit as a day-off trade-off) rather than silently dropped or left unexplained.

Each weekday can differ: leave a day alone to use the default window, give it its own *From–
Until* (a later lunch on a day with a long morning), or blacklist it entirely ("no lunch
block this day") if that day never had a protected lunch to begin with. A fixed lecture that
happens to sit inside the lunch window is left alone either way — lectures are givens, never
dropped or moved to protect lunch — but it's still surfaced as an informational note so the
block's limits are visible rather than assumed away.

`src/domain/solver.ts` searches one variable per enabled subject-with-seminars (which group,
or none) via MRV-ordered DFS with forward checking and branch-and-bound, keeping the best 10
by score. Groups that meet at the exact same day/time (a lab slot taught by several TAs, say)
are collapsed to one representative before search even starts — the score never looks at who
teaches a group. Non-★ lecture drops aren't searched — they're derived directly from which
days are off, since that is the only thing they're ever used for. The search space for a
normal semester is small (23,250 combinations for the bundled sample) so this is exhaustive
and provably optimal in milliseconds; a heavy real semester (tens of groups per subject
across several subjects, ~10⁷ raw combinations) also finishes proven-optimal, typically in
well under a second — collision penalties dwarf every comfort preference, so the
branch-and-bound prunes almost anything that isn't collision-free early. A node-budget guard
falls back to randomised local search on pathological inputs with no exploitable structure at
all, and that result is labelled "best found — not proven optimal" rather than claiming
something it can't prove. The solve itself runs in a Web Worker, debounced, so the UI never
blocks on it.

### A real unavoidable collision

The bundled sample isn't a clean toy: `PV275` ("Intro to Quantum Programming") has exactly
one seminar group, `PV275/01`, and it meets Tuesday 16:00–17:50 — the same slot as `IB111`'s
lecture. Since a non-★ lecture is only ever dropped to satisfy a day off (never to dodge a
collision, per the plan's own design), this pairing has no collision-free resolution with
everything enabled. Loading the sample as-is therefore shows one real seminar-collision badge
out of the box — which is exactly the "never fail, shade it and move on" behaviour this app is
built around, not a bug. Disabling `PV275` (or accepting the collision) is the user's call,
same as any other trade-off the app surfaces.

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
  analysis.ts                      day-off & lunch pre-flight: blockers, drops, dead-subject trade-offs
  lunch.ts                         effective per-day lunch window + slot-overlaps-lunch check
  score.ts                         the objective, its per-term breakdown, and DEFAULT_TUNING
  solver.ts                        MRV/forward-checking/branch-and-bound DFS, group collapsing, top-10, node-budget fallback
  solver.worker.ts                 runs solve() off the main thread
  presets.ts                       default prefs + the four one-click bundles
  teacherFilter.ts                 teacher-chip selection rule: first click exclusive, the rest additive
  format.ts                        minutes<->"HH:MM", day labels, slot/teacher/room descriptions
  __tests__/                       vitest: parser, overlap, analysis, lunch, score, solver (+ real-sample fixture)
src/state/schedulerStore.tsx    useReducer + Context; persists xml/selection/prefs to localStorage
src/components/
  FileDrop.tsx                     drag/drop + "Load sample"
  sidebar/                         SubjectList, SubjectCard, TeacherChips, UnscheduledTray
  prefs/                           PreferencePanel, DayOffToggles, LunchBreak, PresetBar, AdvancedPanel
  grid/                            WeekGrid, HourRuler, DayRow, EventBlock, Legend
  results/                         AlternativesBar, ScoreBreakdown, DiagnosticsPanel, GapExplainer
  ThemeToggle.tsx
src/styles/theme.css            every colour, radius and shadow token, light + dark
src/styles/app.css              layout and every component's styling
```
