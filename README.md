# Schedule Optimizer

A web app that reads a MUNI IS timetable export and works out the best personal weekly
schedule for you.

Lectures are **givens** — the faculty fixes them and you either attend or you don't. The real
decision, and the whole point of this app, is **which seminar group to take for each subject**.
You narrow the candidates (keep only the groups taught by the teacher you want, drop subjects
you aren't taking), state your preferences, and the optimizer searches the remaining
combinations for the schedule that fits you best.

This file is the practical how-it-works. The full reference — the domain model, the
algorithms, the invariants and the reasoning behind them — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What it does

- **Reads the IS export** — the same XML `<rozvrh>` format the school system produces. Drop a
  file on the sidebar or click **Load podzim23** / **Load podzim22** to try the bundled
  `public/podzim23-timetable.xml` / `public/podzim22-timetable.xml`.
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
  next-best schedules and see how their score breaks down against the one you're looking at. Each
  rung is a *different week*, not a different spelling of the same one, and says which days it
  uses. See *Ten different weeks* below.
- **Lets you overrule it.** Every group the optimizer passed over is drawn on the grid as a
  faint strip that says, on hover, exactly what taking it would cost in points — and one click
  takes it. See *Choosing a group yourself* below.
- **Doesn't hand your whole year the same schedule** — a personal *variation seed* decides which
  of the equally-good answers you get, so four hundred people taking the same first-semester
  subjects don't all get sent to seminar group 01. Free by default; an optional **Variety**
  slider will trade a few points for a week that leans a different way. See *Variation* below.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # unit tests (vitest + jsdom) — 213 tests across 13 domain suites
npm run build    # typecheck + production build
```

Node 22 or newer.

The build is a folder of static files — everything runs in the browser, so any plain file
host will serve it. Deploying from a subdirectory needs the path at build time
(`APP_BASE=/~xlogin/scheduler/ npm run build`); [`docs/DEPLOY.md`](docs/DEPLOY.md) has the
details, including the steps for a faculty `public_html` account.

## Reading the input format

The export nests as `<rozvrh>` → `<tabulka>` → `<den>` (a weekday) → `<radek>` (a stacking row,
purely for layout) → `<slot>` (one class meeting). What matters:

| Element | Meaning |
| --- | --- |
| `<minhod>` / `<maxhod>` | Structural grid bounds in minutes — the timetable is drawn 08:00–20:00 |
| `<slot odcas docas>` | Start and end time of a meeting |
| `<akce><kod>` | The class code — see below |
| `<mistnosti>` / `<ucitele>` | Rooms and teachers, repeated once per teaching week (de-duplicated on parse) |
| `<poznamky>` | Notes, referenced by a slot's `<poznamka id>`. Carries **alternating-week** timing — see below |
| `<nezname>` | Course editions with no fixed slot (e.g. substitute/make-up sessions); listed, never scheduled |

The code tells you what kind of class it is:

- `IB111` — a **lecture** of subject `IB111`
- `IB111/03` — **seminar group 03** of subject `IB111`

A subject may have both, or only a lecture (`VV028`). The format also allows a subject
with only seminars and no lecture at all — a language class with several groups, say — the
bundled sample just doesn't happen to include one.

### Alternating-week seminars

Some seminars meet fortnightly rather than weekly, and the export says so **only in prose**,
in the note a slot points at:

> `každé liché pondělí 10:00–11:50` — every **odd** Monday
> `každé sudé pondělí 10:00–11:50` — every **even** Monday

This is why a subject's group list sometimes looks like it has pointless duplicates: in
podzim2022, IB015/05 and IB015/06 are both Monday 10:00–11:50, because they are the two
halves of one fortnight. All 18 IB015 groups, 17 of PB154's and all 44 of VB035's work this
way. Odd/even is a single global cycle — an "odd Monday" and an "odd Thursday" fall in the
same calendar week — so one flag per slot is enough.

Three things follow, and the app now gets all three right:

- **Opposite weeks never clash.** You can take an odd-week IB015 group and an even-week PB154
  group in the very same Friday hour. In podzim2022 that turns 60 of 403 cross-subject time
  overlaps from hard collisions into perfectly good schedules.
- **Both halves are offered.** Groups that share an hour on opposite weeks are no longer
  treated as interchangeable duplicates, so neither half is hidden from the search.
- **The week is scored as two weeks.** Comfort terms are measured over the odd week and the
  even week separately and averaged. This is what keeps a stacked pair honest: on a single
  canvas, an odd class and an even class sharing an hour look like one well-filled day and
  collect roughly 200 points of "barely-used day" credit they haven't earned — you attend one
  110-minute class each week, not a 220-minute day. Measured week by week, stacking wins only
  where it genuinely saves a trip: when it hides a fortnightly class inside a day you're
  already committed to *that same week*.

Anything the parser can't read confidently — a note about overflow rooms, an unfamiliar
phrasing — falls back to "meets every week". Parity may only ever *remove* a constraint, never
add one, so the worst case is a clash shown that isn't real, never a promise of no clash that
turns out to be false. An export with no notes at all (podzim2023) is unaffected end to end.

Fortnightly classes are hatched on the grid and badged `odd` / `even`, in the sidebar group
list as well as on the week itself; the export's own wording is on hover.

## The scoring model

Every candidate schedule gets one number — lower is better — built from seven independent
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

### Ten different weeks, not ten spellings of one

The alternatives strip shows the ten best schedules. That sounds like ten options and often
wasn't: on the autumn 2022 export under neutral preferences, **1 404 combinations tie at the
optimum**, and the ten that reached the strip were routinely the same Monday and Tuesday of fixed
lectures with one seminar pair moved — technically distinct, perceptually identical. Ten rungs
all reading "#n / 55" invite a click through all ten to discover that.

So the strip is deduped by **week shape** — what the week looks like with the labels taken off
(`domain/shape.ts`). Two altitudes, filled in order:

1. **Which days you're on campus, and how loaded each one is.** The difference you notice first.
   A real export yields three to six of these in a top ten, and they go on the strip first.
2. **Which blocks are occupied**, ignoring which subject sits in which. Two subjects trading
   time slots is one week, not two — 12–35 % of shapes on real selections contain such a swap.
   These backfill the remaining rungs, so the strip is still ten rungs deep.

Ignoring the labels is exact rather than approximate: every score term reads only day, start and
end, never who is taught in a block, so two assignments with the same blocks score *identically*
— measured at 0.000000 spread across three real selections, and pinned by a test.

Times are canonicalised against the export's own `<hodiny>` teaching grid before comparing, which
is how a class running to 15:40 and one running to 15:50 count as the same week. (They do occur:
`CORE033` is a university-wide course from another faculty and finishes ten minutes early.)
Rounding to a fixed bucket cannot do this — two times ten minutes apart can straddle a bucket
edge — whereas the grid is the one the timetable is literally drawn on. **The snapped times are
for comparison only and never reach the score**: those ten minutes are real class time, and the
dead-time and barely-used-day terms have to keep charging for them.

Three things the strip still guarantees, unchanged: **#1 is the strict optimum**, the list is
**sorted by real score**, and every rung is **the best-scoring member of its shape** — never an
arbitrary one, so a rung can't hide a better week inside it.

### Choosing a group yourself

The optimizer proposes; you decide. Two ways in, for two different things.

**The faint strips on the grid are the groups it passed over.** Hover one and it tells you what
it is, who teaches it, whether it is fortnightly — and the number that actually settles it:

> +38 points if you switched to this · same score as your current group · would collide with
> another class

They're ranked by that number, so the free swaps stand out and the impossible ones fade back.
**Click one and it's yours.** That group is now pinned: the optimizer stops choosing for that
subject and works around your choice instead. Pinned groups are marked 📌 on the grid and in
the sidebar, one click un-pins, and they're saved with the rest of your preferences.

Pinning fights the optimizer, by design — so the app says what it is costing you, rather than
leaving you to wonder why the week got worse. The line under the score names the pin and a
floor on what un-pinning would win back. A floor, not the exact figure: the precise answer needs
a whole second search, and on the heaviest real export that doubles a fifteen-second solve for
one line of text.

A pin never beats a **hard constraint**. Take Friday off and a pinned Friday group has to lose —
but it loses out loud, in the diagnostics, and the pin comes back when you put Friday back.

**Under the alternatives strip, the same week with the labels moved.** Deduping the strip by
shape (above) means each rung stands for every week with the same blocks — including the ones
where two subjects trade slots. Those are worth seeing: identical grid, identical score, but a
different subject at 8am, which is not a detail everyone is indifferent to.

> Same week, also available as: **IB015** Čt 08:00-09:50 · **IB000** Po 10:00-11:50

Picking one is a jump to a sibling schedule, not an edit — the whole week applies at once, so
there is no half-finished swap to get stuck in, and nothing to undo but clicking *as ranked*.
The list is drawn from the candidates the search kept, so an empty one means none of those, not
none at all.

### Variation — why you aren't handed everyone else's schedule

Up to four hundred people in a first semester take the exact same subjects. Feed the same export
into an optimizer with the same preferences and it will, quite correctly, compute the same best
answer for all of them — and then four hundred people register for the same seminar group. The
optimizer isn't wrong; it simply has no reason to prefer one equally-good answer over another,
so it always picks the same one. A **variation seed** gives it a reason.

The seed is minted once per browser, persisted with your other preferences, and shown in the
Preferences panel. Every random choice the solver makes is a pure function of it, so **the same
seed and the same preferences always produce the same week** — dragging a slider re-solves, it
doesn't reshuffle. It survives *Reset preferences*, clearing the file, and loading next
semester's export, because none of those should silently move you into a different group. Reroll
it for a different draw, or paste a friend's to land in their group deliberately.

Three things used to make a cohort converge. Two of them are free to fix and are always on:

1. **Interchangeable groups.** Faculties open parallel groups precisely to absorb a big year: the
   same lab, the same hour, several teaching assistants. `buildVariables` collapses groups
   sharing a day/time signature into one representative, since the score never looks at who
   teaches a group — and it used to keep the lowest group number, which is how an entire year
   ended up in group 01. The representative is now drawn from the seed instead. This costs
   **exactly zero points** and is usually the single biggest effect.
2. **Score ties.** Two genuinely equal-cost weeks were separated by comparing group ids
   lexicographically — not a preference at all, just the same systematic bias again. Ties now
   break per seed, after score and finish time, which are real preferences and still come first.

The third isn't free, and the app says so. **Monday-heavy weeks aren't a tie** — they genuinely
score better, because the lectures are anchored there and piling seminars onto a day you're
already on campus for beats opening a fresh one. Moving off that means accepting a slightly worse
week, so the **Variety** slider is off until you turn it on:

- It never perturbs the score. Jittering the objective would corrupt the number shown to you and
  break the solver's branch-and-bound lower bound, which assumes the score terms are exactly what
  `score.ts` says. Instead the search runs untouched and `variety.ts` re-ranks *afterwards*,
  within a band of `variety × varietyToleranceMax` points (default budget 60 — far below a
  dropped lecture at 2 000, further still below a collision at 100 000, so variation can never
  buy either).
- The alternatives strip stays a truthful ladder, sorted by real score. Variety **marks** a rung
  rather than reordering them, the price of the pick is printed in points, and the strict optimum
  stays one click away. The rungs it chooses between are the distinct week shapes described
  above, so the band has genuinely different weeks to work with rather than forty relabellings
  of one.
- Each seed also gets its own ranking of the weekdays, and within the band prefers weeks leaning
  its way. Plain jitter would be weak here, because the whole near-optimal band can be
  Monday-heavy; a per-student day ranking is what actually spreads the cohort. Across a year those
  rankings are uniform, so the week fills out while each person still gets a schedule as good as
  the best one available to them.

**What it does not do**, stated plainly in the app as well as here: it doesn't coordinate anybody
— nothing talks to anyone else's copy or to the registration system, so two students can still
draw the same group. It stops the tool *amplifying* the pile-up; it does not allocate capacity,
which would need a server that knows who has booked what. It also can't spread what isn't there:
a subject with one seminar group gives everyone that group. The line under the alternatives strip
reports how much room your particular timetable actually offered, so "nothing changed" reads as a
fact about the timetable rather than a broken feature. And registration order still decides
reality — this proposes, the university's system allocates.

The mechanics live in `domain/random.ts` (hashing, the PRNG, seeds, day rankings) and
`domain/variety.ts` (the tolerance band and the re-ranking), both pure and unit-tested, including
the cohort-level distribution claims. The *Why you aren't handed everyone else's schedule* panel
at the bottom of the page demonstrates them by running a synthetic cohort of 400 seeds through
the very same functions.

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
docs/ARCHITECTURE.md            architecture and domain reference
public/podzim23-timetable.xml   bundled example export (podzim23)
public/podzim22-timetable.xml   bundled example export (podzim22)
src/domain/                     pure TypeScript, no React — unit-testable headlessly
  types.ts                        Day, Slot, CourseEvent, Subject, Timetable, Prefs, Selection, Solution
  parseTimetable.ts                XML -> Timetable
  overlap.ts                       interval overlap + lecture-lecture vs seminar classification
  parity.ts                        fortnightly seminars: note parsing, coincidence, per-week views
  reclassify.ts                    asLecture(): treat a seminar group as lecture-like
  analysis.ts                      day-off, lunch & pin pre-flight: blockers, drops, dead-subject trade-offs
  lunch.ts                         effective per-day lunch window + slot-overlaps-lunch check
  score.ts                         the objective, its per-term breakdown, and DEFAULT_TUNING
  shape.ts                         week-shape identity: day loads, block shapes, the <hodiny> time snap
  switching.ts                     what swapping one group would cost; ghost tiers; what pins cost
  variants.ts                      the other labellings a deduped rung stands for
  variety.ts                       the tolerance band, day affinity, shape-diverse selection
  random.ts                        seeded hashing, PRNG, seed minting, per-seed day rankings
  solver.ts                        MRV/forward-checking/branch-and-bound DFS, group collapsing, top-10, node-budget fallback
  solver.worker.ts                 runs solve() off the main thread
  presets.ts                       default prefs + the four one-click bundles
  teacherFilter.ts                 teacher-chip selection rule: first click exclusive, the rest additive
  format.ts                        minutes<->"HH:MM", day labels, slot/teacher/room descriptions
  __tests__/                       vitest: parser, overlap, analysis, lunch, score, shape, switching,
                                   variants, pinning, solver, variety (+ real-sample fixtures)
src/state/schedulerStore.tsx    useReducer + Context; persists xml/selection/prefs to localStorage
src/components/
  FileDrop.tsx                     drag/drop + "Load podzim23"/"Load podzim22"
  sidebar/                         SubjectList, SubjectCard, TeacherChips, UnscheduledTray
  prefs/                           PreferencePanel, DayOffToggles, LunchBreak, PresetBar, AdvancedPanel
  grid/                            WeekGrid, HourRuler, DayRow, EventBlock, Legend
  results/                         AlternativesBar, ShapeVariants, ScoreBreakdown, PinStatus,
                                   DiagnosticsPanel, GapExplainer
  ThemeToggle.tsx
src/styles/theme.css            every colour, radius and shadow token, light + dark
src/styles/app.css              layout and every component's styling
```
