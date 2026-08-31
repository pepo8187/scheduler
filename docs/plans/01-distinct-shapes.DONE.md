# Plan 1 — Distinct week shapes in the alternatives strip

**✅ STATUS: DONE — already implemented.** Landed as `domain/shape.ts` + a hierarchical
`selectDiverse`, on by default for every user. What was built and how it differs from this plan
is recorded at the end under *What shipped*. Depended on the alternating-week parity work
(merged, PR #14).

**Scope:** presentation only. No new selection state, no new user interaction. Plan 2
(`02-choosing-within-a-shape.DONE.md`) builds the interactive half on top of what this one
establishes, so land this first.

---

## The problem

The alternatives strip (`src/components/results/AlternativesBar.tsx`) shows the top 10
solutions, sorted by score. After the parity work un-collapsed odd/even twins there are far
more equal-scoring solutions than before — under neutral preferences on
IB015+PB154+VB035 (podzim2022), **1,404 combinations tie at the optimum**.

The strip currently keeps them distinct only *by accident*. `makeCompareSolutions`
(`src/domain/solver.ts:254`) breaks ties with per-seed jitter, which scatters them well in
practice — measured across two seeds and two selections, today's top 10 already contains
**9–10 distinct block-shapes out of 10**. Nothing guarantees that, and a degenerate export
could easily produce ten relabelings of one week.

But the more interesting finding is that block-level distinctness **is not what makes the
strip feel varied**. Here is a real top 10 (podzim2022, IB015+PB154+IB000+IB111, seed
`alice`), with the fixed lecture blocks shown in full:

```
#1  Po08 Po12 Po14 Po16 Út10 Út12 + Pá08e Pá10e
#5  Po08 Po12 Po14 Po16 Út10 Út12 + Pá10e Pá12e
#6  Po08 Po12 Po14 Po16 Út10 Út12 + St08e St10e
#7  Po08 Po12 Po14 Po16 Út10 Út12 + St10o St12o
#9  Po08 Po12 Po14 Po16 Út10 Út12 + St08o St10o
```

Ten technically distinct shapes, but the Monday and Tuesday are identical in nine of them
(those are lectures — fixed input, not a choice), and only one pair of blocks moves. That is
the sameness a user actually perceives, and a block-level dedupe does nothing about it,
because these rows genuinely do have different blocks.

## What already exists

`src/domain/variety.ts` already has most of the machinery:

- `weekShapeKey` (`variety.ts:70`) — day → total minutes. A **coarse** shape identity.
- `selectDiverse` (`variety.ts:168`) — best-first pass keeping one solution per
  `weekShapeKey`, then filling remaining rungs from the leftovers.

On the same pools, `weekShapeKey` yields **3–6 distinct values in the top 10** where the block
key yields 9–10. That is the diversity the user is asking for.

**It is gated behind `variety > 0`** (`src/domain/solver.ts:453`):

```ts
const solutions = tolerance > 0 ? selectDiverse(best, topK, compare) : best.slice(0, topK);
```

Variety is off by default, so almost nobody gets it.

## Measured facts this plan relies on

Verified against the real exports; re-derive with a throwaway test if you want to confirm.

**1. Ignoring which subject sits in which block is exactly the right equivalence.** Every
score term (`compactnessTerm`, `sparseDayTerm`, `gapsTerm`, `dayWindowTerm`, `maxPerDayTerm`
in `src/domain/score.ts`) reads only `day`/`start`/`end`, never subject identity. So the same
multiset of blocks implies the same score, by construction. Measured max score spread within
one block-shape, across three selections: **0.000000, 0.000000, 0.000000.**

**2. Permutations are common.** Block-shapes containing more than one *labelling* (i.e. two
subjects trading slots): **28/242, 98/276, 94/298** across three selections — 12–35%. Plan 2
surfaces these; this plan only has to avoid treating them as different weeks.

**3. Near-identical times are real, and the podzim2024 export
(`fixtures/timetables/podzim24-timetable.xml`) contains them.** Two slots that overlap at
near-identical but unequal times:

| | |
|---|---|
| `CORE033` | St 14:00–**15:40** (100 min) |
| `MA018`, `PB007/01` | St 14:00–**15:50** (110 min) |

`CORE033` is a university-wide course from a different faculty, which is where the 10-minute
difference comes from. These are the same week to a human and should not occupy two rungs.

**4. …but the tolerance must be tight.** The same file has same-start pairs that must *not*
merge:

| day/start | ends present | difference |
|---|---|---|
| St 14:00 | 15:40 / 15:50 | 10 min — **merge** |
| Út 12:00 | 12:50 / 13:50 | 60 min — keep apart |
| Út 16:00 | 16:50 / 17:50 | 60 min — keep apart |
| Pá 08:00 | 09:50 / 14:40 | 290 min — keep apart |

## Design

### The canonical time: snap to the export's own hour grid

The obvious approach — round times to a fixed 15-minute bucket — **fails on boundaries**. Two
times 10 minutes apart can straddle a bucket edge and stay separate: 15:37 → 15:30 and
15:47 → 15:45. Verified failing.

Snap to the nearest `<hodiny>` row boundary instead. The export already declares its own
teaching grid (`08:00–08:50`, `09:00–09:50`, … — 12 rows), it is already parsed into
`Timetable.hours`, and it is the grid the timetable is literally drawn on. Measured on the
real cases:

| pair | want | round-to-15 | snap-to-grid |
|---|---|---|---|
| 15:40 vs 15:50 | same | same | **same** |
| 12:50 vs 13:50 | different | different | **different** |
| 16:50 vs 17:50 | different | different | **different** |
| 15:37 vs 15:47 | same | ✗ different | **same** |

No arbitrary constant, no boundary fragility, and it degrades safely: a slot far from any grid
row (the 400-minute `p947` block sessions) snaps to whatever is nearest and simply never
collides with anything else.

**Snapped times are for display keys only. They must never reach `scoreResolved`** — a
10-minute difference is real class time and the sparse-day and gap terms must keep charging
for it.

### Three keys, coarse to fine

| key | identity | distinct in top 10 |
|---|---|---|
| `dayLoadKey` (existing `weekShapeKey`) | day → total minutes | 3–6 |
| `blockShapeKey` (new) | multiset of snapped day/start/end/parity, labels ignored | 9–10 |
| `assignmentKey` (existing, `variety.ts:78`) | exact group ids | 10 |

`dayLoadKey` is too coarse on its own — it merges a Monday-morning week with a
Monday-afternoon week, since both are "Po: 220min". `blockShapeKey` is too fine to change
anything. Use both, hierarchically.

### Hierarchical `selectDiverse`

Extend `selectDiverse` from one key to an ordered list of keys, filling the strip in passes:

1. best solution of each distinct `dayLoadKey` → 3–6 genuinely different weeks at the top
2. fill remaining rungs from unused `blockShapeKey`s
3. fill any remainder from the leftovers, as today

The result: "here are your 4 real options" up top, finer variations below. The strip stays a
truthful ladder — every rung is still the best solution of its class, and the list is still
sorted by real score, so `AlternativesBar`'s existing score display keeps working and the
README's promise (line ~233, "a truthful ladder, sorted by real score") stays true.

### The representative rule — best first, then seed

Within a class, **take the best score; seed-pick only among those tied at that best.**

For an exact block-shape this is free — fact 1 above proves the members are score-identical,
so any pick costs nothing. It stops being free once times are snapped: 15:40 and 15:50 score
slightly differently, so a class can contain members with genuinely different scores, and a
seed-random pick could hand a student a strictly worse week with the better one invisible
inside the class. Sorting the pool by `compare` before the passes gives this for free, since
`compare` is already score-first.

### Turning it on by default

Change `solver.ts:453` to always run the diverse selection. Note this is a behavioural change
for every user, not just those with variety on, so it needs its own commit and a note in the
README.

`pickVariety` runs on `solutions` after this, and `VARIETY_POOL_FACTOR` (`solver.ts:15`)
widens the internal pool only when variety is on. Diversity now needs a wider pool too:
consider applying the pool widening unconditionally, and measure the search cost before
committing to it — `solver.test.ts`'s performance guard is the tripwire.

---

## Steps

**0. Nothing to do — the fixture is already in the repo.** The `CORE033` 15:40-vs-15:50 case
is the only real evidence for the snapping rule, and it lives at
`fixtures/timetables/podzim24-timetable.xml`. It is deliberately **not** in `public/`: Vite
copies that directory into the build, and this export is for testing, not an in-page example.
Read it with `readFileSync(resolve(process.cwd(), 'fixtures/timetables/podzim24-timetable.xml'), 'utf8')`.
See `fixtures/timetables/README.md` for what else it exercises.

**1. `domain/shape.ts` (new).**
- `canonicalTime(minutes, hours)` — snap to the nearest `<hodiny>` boundary.
- `blockShapeKey(events, hours)` — sorted multiset of `day:snappedStart-snappedEnd[:parity]`,
  subject labels excluded.
- `dayLoadKey` — re-export or move `weekShapeKey` here; keep the name working from
  `variety.ts` to avoid churn in `pickVariety`.
- Document why snapping is display-only.

**2. Generalise `selectDiverse` (`variety.ts:168`)** to take an ordered array of key functions
and run one pass per key, then the leftovers. Keep the existing single-key call working.

**3. Flip `solver.ts:453`** to always select diversely. Decide and document what happens to
`poolK`.

**4. Surface the shape in the strip.** `AlternativesBar` currently shows rank + score. Add a
compact hint of what makes each rung different — the days used, or the differing blocks.
Keep it small; the strip is a strip. This is also the hook Plan 2 hangs its variant list on.

**5. Docs.** README "Variation" section; update `docs/ARCHITECTURE.md` — the alternating-week
notes in § The objective function, and strike the ties entry from § Known gaps and open work.

## Tests

- `canonicalTime`: the four real pairs in the table above, plus the 15:37/15:47 boundary case
  that fixed bucketing gets wrong.
- `blockShapeKey`: two assignments that differ only by which subject sits in which block
  produce the **same** key; a genuine time difference produces a different one.
- The score-identity property (fact 1): assert that two events with the same block multiset
  score identically. Cheap, and it pins the invariant the whole design rests on.
- `selectDiverse` hierarchical: a pool with 3 dayLoads × 4 block-shapes fills the first three
  rungs from distinct dayLoads.
- Representative rule: a class whose members have unequal scores always yields the best, for
  every seed.
- Regression: podzim2023 (no parity, uniform 110-minute slots) — the strip must not get
  *worse*, i.e. still 10 rungs, still score-sorted.
- Performance: `solver.test.ts:474` is the guard. It now allows 30 s with a 60 s vitest
  timeout; re-measure rather than raising it again.

## Risks and open questions

- **Snapping could over-merge on an unusual export.** A faculty whose classes genuinely sit
  between grid rows would see two real alternatives merged into one rung. The failure is
  benign (a hidden alternative, not a wrong schedule) and the class still lists its members,
  but worth a second export to confirm.
- **Fewer effective rungs.** Deduping to 3–6 genuine shapes may leave the strip looking
  emptier. Passes 2 and 3 backfill to 10, so this is a presentation question: is a rung that
  differs only slightly worth showing? Decide with the strip in front of you.
- **Out of scope, found while investigating:** podzim2024's `p947` groups are 400-minute
  sessions taught on three specific dates ("pouze Pá 4. 10., 18. 10. a 25. 10."), not weekly
  at all. The app models them as a 6h40m weekly commitment, which badly overstates them. A
  third cadence beyond weekly/fortnightly — worth its own plan, not this one.

---

## What shipped

Built as written, with these decisions taken where the plan left them open:

- **`poolK` is widened unconditionally**, `topK × POOL_FACTOR` (4), rather than only with
  Variety on — the dedupe needs the same headroom the band does. Measured before committing:
  on the two bundled exports and the podzim24 fixture the search cost goes 9–16 ms → 14–23 ms
  (vitest, shared CI container), and podzim2022 is unchanged — it is dominated by the search
  space, not the pool width. Confirmed afterwards in a real browser on the full eight-subject
  selection: `master` 7 964 ms against this work 7 972 ms, five runs each.
  The performance guard passes untouched. Factor 4 rather than 6: at 6 the strip reaches ten
  distinct day loads on podzim23 but spends its last rungs on visibly worse weeks (100 125 vs
  100 110), which is a worse trade than the extra shape buys. `VARIETY_POOL_FACTOR` was renamed
  `POOL_FACTOR` accordingly.
- **Step 4 shows the day set**, not the differing blocks: each rung prints "Po Út Pá"
  (`describeShapeDays`). It is the visible face of `dayLoadKey`, which is the key pass 1 dedupes
  on, so it is exactly what differs between the rungs at the top of the strip.
  Running the real thing showed that is not enough on its own — this plan's own instruction to
  "decide with the strip in front of you". On podzim2022 with everything enabled, all ten rungs
  print "Po Út St Čt · 122": they are backfilled by `blockShapeKey` and use the same days for
  the same minutes, differing only in *when*. So the hover carries each day's load **and start
  times**, one line per day, which by construction differs on every rung the strip can show —
  it is what `blockShapeKey` is built from.
- **Measured effect**, top ten, neutral preferences, five subjects per export: distinct
  `dayLoadKey`s went 5 → 8 on podzim23 and 2 → 8 on podzim24. On podzim2022 it stays at 3: all
  1 404 optimum-tied combinations there really do use the same three day loads, so the strip
  spends its remaining rungs on distinct block shapes instead, which is the intended fallback.

Open risks from above, as they stand now:

- **Over-merging on an unusual export** remains unconfirmed either way; no second export with
  genuinely off-grid classes has been checked. The failure stays benign (a hidden alternative).
- **Fewer effective rungs** did not materialise — passes 2 and 3 backfill to ten on every export
  tried.
- **Block-taught sessions** (podzim24's `p947`) are still modelled as weekly; untouched here, and
  now recorded in `docs/ARCHITECTURE.md` § Known gaps.
