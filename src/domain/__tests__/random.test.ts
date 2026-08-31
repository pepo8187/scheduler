import { describe, expect, it } from 'vitest';
import { DAY_ORDER } from '../format';
import { dayAffinity, hashString, mulberry32, newSeed, normalizeSeed, pickFrom, unitFrom } from '../random';

const WEEKDAYS = DAY_ORDER.slice(0, 5);

/** A deterministic stand-in cohort, so every distribution assertion here is reproducible. */
function cohort(size: number): string[] {
  const random = mulberry32(20250830);
  return Array.from({ length: size }, () => newSeed(random));
}

describe('hashString', () => {
  it('is stable and separates keys that differ only slightly', () => {
    expect(hashString('MA012')).toBe(hashString('MA012'));
    expect(hashString('MA012')).not.toBe(hashString('MA013'));
    expect(hashString('')).toBe(hashString(''));
  });
});

describe('unitFrom', () => {
  it('always lands in [0, 1)', () => {
    for (const seed of cohort(200)) {
      const value = unitFrom(seed, 'x');
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('depends on every coordinate, not just the seed', () => {
    expect(unitFrom('AAAA-1111', 'a')).not.toBe(unitFrom('AAAA-1111', 'b'));
    expect(unitFrom('AAAA-1111', 'a')).not.toBe(unitFrom('BBBB-2222', 'a'));
  });
});

describe('pickFrom', () => {
  const groups = Array.from({ length: 8 }, (_, i) => `BB/0${i}`);

  it('is stable for the same coordinates — the same question always gets the same answer', () => {
    for (const seed of cohort(50)) {
      expect(pickFrom(groups, seed, 'BB', 'sig')).toBe(pickFrom(groups, seed, 'BB', 'sig'));
    }
  });

  it('only ever returns a member of the list, and handles the empty one', () => {
    for (const seed of cohort(100)) expect(groups).toContain(pickFrom(groups, seed, 'BB', 'sig'));
    expect(pickFrom([], 'AAAA-1111')).toBeUndefined();
    expect(pickFrom(['only'], 'AAAA-1111')).toBe('only');
  });

  it('spreads a cohort across every option instead of piling it onto one', () => {
    // The whole point of the feature: with the old lowest-id rule this was 100%/0%/0%…
    const counts = new Map(groups.map((g) => [g, 0]));
    for (const seed of cohort(2_000)) {
      const picked = pickFrom(groups, seed, 'BB', 'sig')!;
      counts.set(picked, counts.get(picked)! + 1);
    }
    for (const group of groups) {
      const share = counts.get(group)! / 2_000;
      expect(share).toBeGreaterThan(0.08); // an even split is 12.5%; generous band, no flake
      expect(share).toBeLessThan(0.18);
    }
  });
});

describe('newSeed / normalizeSeed', () => {
  it('formats as two readable blocks and avoids the ambiguous glyphs', () => {
    for (const seed of cohort(200)) {
      expect(seed).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(seed).not.toMatch(/[OIL01]/); // never mistake a seed read out loud
    }
  });

  it('produces different seeds on successive draws', () => {
    expect(new Set(cohort(500)).size).toBeGreaterThan(490);
  });

  it('makes a hand-typed seed match the one that was shared', () => {
    expect(normalizeSeed(' 7qf3-2k91 ')).toBe('7QF3-2K91');
    expect(unitFrom(normalizeSeed('7qf3-2k91'), 'x')).toBe(unitFrom('7QF3-2K91', 'x'));
  });

  it('leaves an arbitrary pasted string usable rather than mangling it', () => {
    expect(normalizeSeed('my lucky seed')).toBe('MY LUCKY SEED');
  });
});

describe('dayAffinity', () => {
  it('ranks every weekday exactly once, best to worst', () => {
    const { order, weight } = dayAffinity('7QF3-2K91');
    expect([...order].sort()).toEqual([...WEEKDAYS].sort());
    expect(weight[order[0]!]).toBe(1);
    expect(weight[order[4]!]).toBe(0);
    for (let i = 1; i < order.length; i++) {
      expect(weight[order[i]!]).toBeLessThan(weight[order[i - 1]!]);
    }
  });

  it('stays neutral about weekends, which the app never schedules into', () => {
    const { weight } = dayAffinity('7QF3-2K91');
    expect(weight['So']).toBe(0.5);
    expect(weight['Ne']).toBe(0.5);
  });

  it('is stable for a seed', () => {
    expect(dayAffinity('7QF3-2K91').order).toEqual(dayAffinity('7QF3-2K91').order);
  });

  it('puts each weekday first for about a fifth of a cohort', () => {
    // This is what actually breaks the Monday lean: uniform first choices across the year.
    const counts = new Map(WEEKDAYS.map((d) => [d, 0]));
    for (const seed of cohort(2_000)) {
      const top = dayAffinity(seed).order[0]!;
      counts.set(top, counts.get(top)! + 1);
    }
    for (const day of WEEKDAYS) {
      const share = counts.get(day)! / 2_000;
      expect(share).toBeGreaterThan(0.14); // uniform is 20%
      expect(share).toBeLessThan(0.26);
    }
  });
});
