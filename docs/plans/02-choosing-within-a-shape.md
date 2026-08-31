# Plan 2 — Choosing within a shape

**Status:** **done.** All five steps landed; what shipped and where it differs from this plan is
recorded at the end under *What shipped*. Depended on Plan 1 (`01-distinct-shapes.md`), also done.

**Scope:** the interactive half — letting a user see what else could occupy a slot and act on
it. Adds new selection state, which Plan 1 deliberately does not.

---

## The problem

Once the strip shows one representative per shape (Plan 1), everything inside a shape becomes
invisible. That hidden content is substantial and genuinely useful:

**Permutations.** Two subjects trading time slots — IB015 moves from Monday 10:00 to Thursday
08:00 while IB000 moves the other way. Same week, same score (provably: the score never reads
subject identity), different labels. Measured frequency of block-shapes containing more than
one labelling: **28/242, 98/276, 94/298** across three real selections — **12–35% of shapes
have a genuine swap available.**

**Substitutions.** A different group of the *same* subject at a different time. The grid
already draws these as "ghost" blocks (`src/components/grid/WeekGrid.tsx:53`, rendered thin
and dashed by `DayRow.tsx:41`) — every enabled-but-unchosen group, at its own day/time. They
are visible but inert: you cannot learn anything from one or act on it.

## The critical distinction

These are **two different operations** and conflating them is the main design trap here.

| | substitution | permutation |
|---|---|---|
| what changes | one subject's chosen group | two subjects trade slots |
| variables touched | 1 | 2 (or more — an n-cycle) |
| expressible as one block click? | **yes** | **no** |
| natural home | the ghost block | the shape's variant list |

A per-block click cannot express a swap. Clicking "IB000 goes here" on the 10:00 block leaves
IB000 *also* at 08:00 until the other half of the swap happens; a single-variable edit cannot
represent a simultaneous exchange. Trying to force swaps into the block-click interaction is
where the "overwhelming amounts of information" worry comes from — you end up needing to show
a cross-product at every block.

Splitting them dissolves that: each surface shows one short list.

## Design

### A. Ghost hover — substitutions, no new state

Hovering a ghost block explains what it is and what taking it would cost:

- which group it is, its teacher and room (already on `CourseEvent`)
- its cadence, if fortnightly (`describeParity` from `domain/parity.ts`)
- **the score delta** if the user switched to it — the number that makes this worth reading

The delta needs a solve with that group forced. Do not run the full solver per hover: compute
the deltas once per solution, for every ghost, in a `useMemo` alongside `ghostsByDay`. Each is
a single `resolveAssignment` + `scoreResolved` on a modified `seminarChoice` — cheap, and it
lets the ghost row be *ranked*, dimming the ones that would cost a lot.

This is pure win: no new state, no new concepts, and it makes an existing but inert piece of
UI informative.

### B. `pinned` — the new state click-to-switch needs

Today a user can only **enable/disable** groups (`SubjectSelection.seminars`,
`src/domain/types.ts:174`); the solver chooses among whatever is enabled. There is no way to
say "I want *this* one". So "click a ghost to switch to it" has nowhere to write its result.

Add a third map alongside `seminars` and `reclassified` (`types.ts:181`):

```ts
pinned: Record<string, boolean>;  // CourseEvent.id -> the user's explicit choice
```

At most one pinned group per subject. A pinned subject stops being a searched variable in
`buildVariables` (`src/domain/solver.ts:~160`) and becomes fixed input, exactly as a
reclassified seminar already does — so the pattern to copy is already in the codebase.

**Rejected alternative:** implementing the click as "disable every sibling group". It needs no
new state, but it destroys the user's enable/disable choices to express a *different* intent,
and the existing "Reset groups" button would then silently un-pin. Roughly 30 lines more to do
it honestly.

Pinning must be:
- **visible** — a pinned block is marked on the grid and in the sidebar row, or the user will
  not understand why the optimizer stopped moving it
- **reversible** — one click to un-pin, and a "clear pins" affordance per subject
- **persisted** — it goes through the same store/localStorage path as the rest of `Selection`
  (`src/state/schedulerStore.tsx`)
- **honest about cost** — pinning can make the whole schedule worse; show the delta, the same
  number the hover promised

Watch the interaction with a day off and with lunch: a pinned group that a hard constraint
forbids has to lose, and say so, rather than silently producing an infeasible week. The
existing `analyzeDayOff`/`analyzeLunch` "deadSubjects" diagnostics (`src/domain/analysis.ts`)
are where that warning belongs.

### C. Shape variants — permutations, at the right altitude

For the currently displayed solution, list the *other labellings of the same block shape*:

> Same week, also available as: **IB015** at Thu 08:00 / **IB000** at Mon 10:00

Picking one applies the whole assignment at once — it is a jump to a sibling solution, not an
edit, so it needs no new state at all and cannot produce an inconsistent intermediate.

The candidates are already in hand: they are the members of the current rung's shape class,
which Plan 1 computes when it dedupes. Have `selectDiverse` return the collapsed members
alongside each representative rather than discarding them (`SolveResult` already carries
`interchangeable` in exactly this spirit — `solver.ts:213` — so extend that pattern rather
than inventing a new one).

Keep the list short. Show at most a handful, and describe each by **what differs**, not by
listing the whole week — the shape is identical by definition, so only the labels are news.

---

## Steps

1. **Ghost hover detail** (A). Precompute per-ghost score deltas in `WeekGrid`; extend
   `DayBlockInfo` (`src/components/grid/gridTypes.ts`) to carry the delta; render on hover.
   Ship this alone — it is independently valuable and needs no new state.
2. **Shape variants** (C). Have Plan 1's dedupe retain class members; surface them under the
   strip or beside the grid; clicking selects that solution. Still no new state.
3. **`pinned` state** (B). `types.ts` → `schedulerStore` action + reducer → `buildVariables`
   treats a pinned group as fixed → grid and sidebar markers → un-pin affordance →
   diagnostics for a pin a hard constraint forbids.
4. **Click-to-apply on a ghost.** The payoff of step 3: clicking a ghost pins that group.
5. **Docs.** README needs a short section; `docs/ARCHITECTURE.md` needs `pinned` added to the
   `SubjectSelection` block and its semantics list in § Domain model.

Steps 1 and 2 are safe and self-contained. Step 3 is the one that changes the domain model —
give it its own commit.

## Tests

- Ghost delta: switching to a known-worse group reports a positive delta of the right size;
  switching to a tied group reports 0.
- `pinned` in `buildVariables`: a pinned subject contributes no domain variable and its group
  always appears in the solution.
- Pin vs. hard constraint: a pinned group on a day the user then takes off must not silently
  survive — assert the diagnostic fires.
- Pin persistence: round-trips through the store's serialisation with `seminars` and
  `reclassified`.
- Shape variants: for a block-shape with a known permutation (pick one from the 98/276 in
  podzim2022, IB015+PB154+VB035), the variant list contains the swapped labelling and every
  member scores identically.
- Regression: with nothing pinned, `solve` returns exactly what it does today.

## Risks and open questions

- **Ghost row density.** VB035 has 44 groups; with everything enabled the ghost row is already
  dozens of strips. Hover is opt-in so it costs nothing until used, but ranking the ghosts by
  delta (and dimming or hiding the hopeless ones) may be necessary to make the row readable.
  Decide with the real export loaded.
- **Pinning fights the optimizer, by design.** A user who pins several groups may end up with
  a much worse week and no clear signal why. The score delta on each pin is the mitigation;
  consider a single "pins are costing you N points" line near the score breakdown.
- **Is a permutation actually interesting to a student?** It changes *which subject* you have
  at 8am, which matters if you care about the teacher or the subject's difficulty, and is
  irrelevant otherwise. Worth checking with a real user before building step 2 — it is the
  step with the least certain payoff. The teacher filter (`domain/teacherFilter.ts`) suggests
  people do care who teaches, which is mild evidence for it.
- **Interaction with variety.** `pickVariety` marks a rung as the seed's pick. A pinned choice
  overrides that entirely; make sure the two do not both claim to have chosen the week.

---

## What shipped

All five steps, in the order written, one commit each. Where the plan left a decision open or
where measurement contradicted it:

- **`pinned` is not quite "no domain variable, exactly like a reclassified seminar".** It is no
  domain variable — correct as written — but it stays a **seminar** rather than becoming
  lecture-like, because a collision a pinned group causes must be charged as a seminar collision
  rather than quietly exempted the way a lecture↔lecture overlap is. It also joins the
  forward-checking list, which the plan did not call for and which is free: every other subject
  now prunes against the pinned group before the DFS starts.
- **"Pins are costing you N points" is a lower bound, not the figure.** The plan asked for the
  honest number, which needs a second full search with pins ignored. Measured before building
  it: on podzim22 that baseline solve takes **14.8 s against the real solve's 14.6 s** — the
  branch-and-bound bound is collision-dominated, so even `topK: 1` prunes nothing extra. Doubling
  a fifteen-second solve for one line of text is not a trade worth making. `pinRelief` asks the
  cheap local question instead — is one of this subject's own siblings better right now? — which
  is already computed for the ghost hovers and is a true floor on what un-pinning would recover.
  The line says "at least" for that reason.
- **No separate "clear pins" affordance.** With at most one pin per subject, clicking the pinned
  row's 📌 is the un-pin, so a second control would have had nothing to do.
- **Un-pinning is not available from the grid.** A ghost click pins; a pinned block does not
  un-pin on click. Blocks have no other click meaning, so an accidental click on a thin ghost is
  nearly always deliberate, while one on a full-size block would silently undo a choice. The
  pinned block's tooltip points at the sidebar.
- **Hard constraints overrule a pin without deleting it.** The plan asked for the diagnostic;
  the surrounding rule is that switching a group off, filtering it away or reclassifying it
  *does* un-pin (the pin is then a statement about nothing), while a day off or the lunch block
  does not — those are often temporary, and the pin should return when they lift.
- **Ghost strips grew from 8px to 10px** once they became buttons. Fine as decoration, not a
  target anyone can hit.
- **Measured variant availability** (five subjects, neutral preferences): 7 of 10 rungs on
  podzim22 hide a swap, including a five-subject cycle; 4 of 10 on podzim23; **none on
  podzim24**. Every variant scores identically to its rung, as predicted.

Open risks from above, as they stand now:

- **Ghost row density** was not a problem in practice once the strips were ranked and the
  hopeless ones faded — but this has not been looked at with VB035's 44 groups all enabled on a
  small screen.
- **"Is a permutation actually interesting to a student?"** is still unanswered; it wants a real
  user, not a measurement. The step is cheap and self-contained enough to remove if the answer
  is no.
- **The variant list is bounded by the search pool**, so an empty list means "none among the
  candidates kept", not "none". Widening the pool for its sake was not attempted — the pool
  costs search time, and podzim22 is already slow.
- **Pinning vs. variety** does not double-claim: `pickVariety` still marks a rung, and a pinned
  subject simply has one value in every rung, so there is nothing for the two to disagree about.
