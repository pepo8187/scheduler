import { describeSlots } from './format';
import type { Solution, Timetable } from './types';

/**
 * What a rung of the alternatives strip hides.
 *
 * Deduping the strip by week shape is what made it readable, and it is also what made
 * everything inside a shape invisible. Most of that is nothing anyone needs — a rung stands for
 * dozens of weeks that differ in no way a student could point at. But one kind of hidden
 * content is genuinely news: the *other labellings* of the same week. IB015 moves from Monday
 * 10:00 to Thursday 08:00 while IB000 moves the other way, the blocks on the grid are the same
 * blocks, and the score is provably identical — the objective never reads subject identity.
 * Which subject you have at 8am is exactly the sort of thing a student has an opinion about.
 *
 * Picking one is a **jump to a sibling solution, not an edit**: the whole assignment is applied
 * at once, so it can never produce the half-finished state a per-block click would (see
 * `docs/plans/02-choosing-within-a-shape.DONE.md` on why a swap is not expressible as one click).
 * That is why nothing here writes any state.
 *
 * The candidates are already in hand: they are the pool members the strip's dedupe collapsed
 * into each representative. This keeps them instead of discarding them — the same spirit as
 * `SolveResult.interchangeable`, which records what the *search* collapsed.
 */

/** How many variants a rung reports. The list is meant to be read, not paged through. */
export const VARIANT_LIMIT = 4;

/**
 * For each chosen solution, the pool members that share its shape and are not on the strip
 * themselves. Aligned with `chosen` by index; an entry is `[]` when a rung hides nothing.
 *
 * Bounded by what the search kept: the pool is `topK × POOL_FACTOR` candidates, so on a
 * timetable with hundreds of tied weeks this reports the ones that survived to the pool, not
 * every labelling in existence. That is the honest thing to show — they are the ones the strip
 * could actually offer — but it does mean an empty list means "none in the pool", not "none".
 */
export function collectVariants(
  pool: Solution[],
  chosen: Solution[],
  key: (solution: Solution) => string,
  compare: (a: Solution, b: Solution) => number,
  limit: number = VARIANT_LIMIT,
): Solution[][] {
  const onStrip = new Set(chosen);
  const byShape = new Map<string, Solution[]>();
  for (const solution of pool) {
    if (onStrip.has(solution)) continue;
    const shape = key(solution);
    const members = byShape.get(shape);
    if (members) members.push(solution);
    else byShape.set(shape, [solution]);
  }
  return chosen.map((solution) => (byShape.get(key(solution)) ?? []).slice().sort(compare).slice(0, limit));
}

/** One subject that sits somewhere else in this variant than in the rung it belongs to. */
export interface VariantChange {
  subjectCode: string;
  /** The group this variant puts the subject in. */
  groupId: string;
  /** "Čt 08:00-09:50" — where it lands. The only news, since the blocks are identical. */
  when: string;
}

/**
 * What differs between a rung and one of its variants, described by *what moved* rather than by
 * spelling out the whole week — the week is identical by definition, so only the labels are new.
 *
 * Always comes back as a cycle of two or more subjects: one subject alone cannot change slot
 * without changing the shape.
 */
export function describeVariantChanges(base: Solution, variant: Solution, timetable: Timetable): VariantChange[] {
  const changes: VariantChange[] = [];
  for (const subject of timetable.subjects) {
    const before = base.assignment.seminarChoice[subject.code] ?? null;
    const after = variant.assignment.seminarChoice[subject.code] ?? null;
    if (before === after || !after) continue;
    const group = subject.seminars.find((s) => s.id === after);
    if (!group) continue;
    changes.push({ subjectCode: subject.code, groupId: after, when: describeSlots(group) });
  }
  return changes;
}
