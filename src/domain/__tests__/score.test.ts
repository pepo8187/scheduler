import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import {
  GAP_BADNESS_CAP,
  GAP_FREE_MINUTES,
  chargeableGapMinutes,
  computeScore,
  gapBadness,
  gapExponent,
  resolveAssignment,
  WEIGHTS,
} from '../score';
import type { Assignment, CourseEvent, Prefs, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[], group?: string): CourseEvent {
  return { id, subjectCode, kind, group, slots, teachers: [] };
}

function subject(code: string, lectures: CourseEvent[], seminars: CourseEvent[]): Subject {
  return { code, name: code, subjectId: code, facultyUrl: '', periodUrl: '', lectures, seminars };
}

function timetableOf(subjects: Subject[]): Timetable {
  return { minHour: 480, maxHour: 1200, hours: [], subjects, unscheduled: [] };
}

function emptyAssignment(): Assignment {
  return { seminarChoice: {}, droppedLectures: new Set() };
}

describe('resolveAssignment', () => {
  it('includes enabled lectures and the chosen seminar, drops nothing by default', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const groupA = event('AA/01', 'AA', 'seminar', [slot('Út', 480, 570)], '01');
    const groupB = event('AA/02', 'AA', 'seminar', [slot('St', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], [groupA, groupB])]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: { AA: 'AA/01' }, droppedLectures: new Set() };

    const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
    expect(events.map((e) => e.id).sort()).toEqual(['AA', 'AA/01']);
    expect(overlaps).toHaveLength(0);
  });

  it('excludes a dropped lecture and a subject disabled entirely', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [event('BB', 'BB', 'lecture', [slot('Út', 480, 570)])], [])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.enabled = false;
    const assignment: Assignment = { seminarChoice: {}, droppedLectures: new Set(['AA']) };

    const { events } = resolveAssignment(timetable, selection, assignment);
    expect(events).toHaveLength(0);
  });
});

describe('computeScore — seminar collisions', () => {
  it('penalises an overlap between two different subjects heavily, and never penalises lecture-lecture', () => {
    const lectureA = event('LA', 'LA', 'lecture', [slot('Út', 720, 830)]);
    const lectureB = event('LB', 'LB', 'lecture', [slot('Út', 720, 830)]); // overlaps LA
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01'); // overlaps CC/01
    const timetable = timetableOf([
      subject('LA', [lectureA], []),
      subject('LB', [lectureB], []),
      subject('CC', [], [seminarC]),
      subject('DD', [], [seminarD]),
    ]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: { CC: 'CC/01', DD: 'DD/01' }, droppedLectures: new Set() };

    const score = computeScore(timetable, selection, DEFAULT_PREFS, assignment);
    const collisionTerm = score.terms.find((t) => t.key === 'seminarCollision')!;
    expect(collisionTerm.cost).toBe(WEIGHTS.seminarCollisionPerPair); // only the seminar-seminar pair counts
  });
});

describe('computeScore — dropped lectures', () => {
  it('charges a flat cost per dropped lecture, independent of comfort prefs', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('AA', [lecture], [])]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: {}, droppedLectures: new Set(['AA']) };

    const score = computeScore(timetable, selection, DEFAULT_PREFS, assignment);
    const term = score.terms.find((t) => t.key === 'droppedLecture')!;
    expect(term.cost).toBe(WEIGHTS.droppedLecturePerEvent);
  });
});

describe('computeScore — compactness', () => {
  const twoDaySchedule = () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Út', 480, 570)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    return { timetable, selection: buildFullSelection(timetable), assignment: emptyAssignment() };
  };

  it('is neutral (zero cost) at slider 0', () => {
    const { timetable, selection, assignment } = twoDaySchedule();
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: 0 }, assignment);
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBe(0);
  });

  it('charges per day used when pushed toward cram (positive)', () => {
    const { timetable, selection, assignment } = twoDaySchedule();
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: 1 }, assignment);
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBe(2 * WEIGHTS.compactnessPerDayUsed);
  });

  it('charges for load variance when pushed toward spread (negative)', () => {
    // Every weekday used, so the unused-weekday term is zero and only variance counts.
    const days: Array<[Slot['day'], number]> = [
      ['Po', 90],
      ['Út', 180],
      ['St', 90],
      ['Čt', 90],
      ['Pá', 90],
    ];
    const subjects = days.map(([day, minutes], i) => subject(`S${i}`, [event(`S${i}`, `S${i}`, 'lecture', [slot(day, 480, 480 + minutes)])], []));
    const timetable = timetableOf(subjects);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: -1 }, emptyAssignment());
    // mean=108, variance=(18^2*4 + 72^2)/5 = 1296
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBeCloseTo(1296 * WEIGHTS.compactnessVarianceTiebreak);
  });

  it('prefers using an extra weekday over a lower-variance same-day-count arrangement', () => {
    // Two ways to place a 3rd class: as its own light day (more days, worse variance)
    // or piled onto an already-used day (fewer days, better variance). Spread should
    // still take the extra day — day count is the primary lever, variance a tiebreak.
    const heavyA = event('AA', 'AA', 'lecture', [slot('Po', 480, 750)]); // 270 min
    const heavyB = event('BB', 'BB', 'lecture', [slot('Út', 480, 750)]); // 270 min
    const extraOwnDay = event('CC', 'CC', 'lecture', [slot('St', 480, 510)]); // 30 min, new day
    const extraPiled = event('DD', 'DD', 'lecture', [slot('Po', 750, 780)]); // 30 min, same day as AA

    const spreadPrefs: Prefs = { ...DEFAULT_PREFS, compactness: -1 };
    const timetableOwnDay = timetableOf([subject('AA', [heavyA], []), subject('BB', [heavyB], []), subject('CC', [extraOwnDay], [])]);
    const ownDayScore = computeScore(timetableOwnDay, buildFullSelection(timetableOwnDay), spreadPrefs, emptyAssignment());

    const timetablePiled = timetableOf([subject('AA', [heavyA], []), subject('BB', [heavyB], []), subject('DD', [extraPiled], [])]);
    const piledScore = computeScore(timetablePiled, buildFullSelection(timetablePiled), spreadPrefs, emptyAssignment());

    expect(ownDayScore.total).toBeLessThan(piledScore.total);
  });

  it('also charges for leaving weekdays unused when pushed toward spread, unless they are off', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Út', 480, 570)]); // same load: zero variance either way
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);

    const twoOfFive = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: -1 }, emptyAssignment());
    expect(twoOfFive.terms.find((t) => t.key === 'compactness')?.cost).toBeCloseTo(3 * WEIGHTS.compactnessPerUnusedWeekday);

    const withThreeDaysOff = computeScore(
      timetable,
      selection,
      { ...DEFAULT_PREFS, compactness: -1, daysOff: ['St', 'Čt', 'Pá'] },
      emptyAssignment(),
    );
    expect(withThreeDaysOff.terms.find((t) => t.key === 'compactness')?.cost).toBeCloseTo(0);
  });
});

describe('computeScore — gaps', () => {
  it('is zero when gaps preference is at 0 regardless of dead time', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 530)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 800, 850)]); // big gap same day
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, gaps: 0 }, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'gaps')?.cost).toBe(0);
  });

  it('charges exactly the peak-weighted badness for a single gap, per the gaps slider and weight', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 660, 690)]); // 11:00-11:30
    const b = event('BB', 'BB', 'lecture', [slot('Po', 780, 810)]); // 13:00-13:30, 90 min gap
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, gaps: 1 }, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'gaps')?.cost).toBeCloseTo(
      gapBadness(90, DEFAULT_PREFS.gapShape) * WEIGHTS.gapsPerIdleMinute,
    );
    expect(score.terms.find((t) => t.key === 'gaps')?.detail).toBe('90 idle minute(s) in 1 gap(s), 1 over 30 min');
  });

  it('does not care what time of day a gap falls at — no special midday exemption', () => {
    const midday = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 660, 690)])], []), // 11:00-11:30
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 780, 810)])], []), // 13:00-13:30
    ]);
    const morning = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 510)])], []), // 08:00-08:30
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 600, 630)])], []), // 10:00-10:30
    ]);
    const prefs: Prefs = { ...DEFAULT_PREFS, gaps: 1 };
    const middayScore = computeScore(midday, buildFullSelection(midday), prefs, emptyAssignment());
    const morningScore = computeScore(morning, buildFullSelection(morning), prefs, emptyAssignment());
    expect(middayScore.terms.find((t) => t.key === 'gaps')?.cost).toBe(morningScore.terms.find((t) => t.key === 'gaps')?.cost);
  });

  it('rises with gap length and flattens out, but never gets cheaper for a longer gap', () => {
    const shape = DEFAULT_PREFS.gapShape;
    expect(gapBadness(40, shape)).toBeGreaterThan(0);
    expect(gapBadness(60, shape)).toBeGreaterThan(gapBadness(40, shape));
    expect(gapBadness(120, shape)).toBeGreaterThan(gapBadness(60, shape));
    expect(gapBadness(480, shape)).toBeGreaterThan(gapBadness(120, shape)); // an 8-hour gap is never cheaper...
    // ...than a 2-hour one, but the second 6 hours of it add far less badness than the first 120 did,
    // and it stays under the cap however long the gap gets.
    expect(gapBadness(480, shape) - gapBadness(120, shape)).toBeLessThan(gapBadness(120, shape));
    expect(gapBadness(1_000, shape)).toBeLessThan(GAP_BADNESS_CAP);
    expect(gapBadness(1_000, shape)).toBeGreaterThan(GAP_BADNESS_CAP * 0.99);
  });

  it('stays monotonic in length at every position of the break-shape slider', () => {
    // The invariant is non-decreasing and never above the cap. Past roughly 8 hours at the
    // "several short breaks" end the curve saturates to exactly the cap in double precision,
    // which is the flat top doing its job, not the cap being breached.
    for (const shape of [0, 0.25, 0.5, 0.75, 1]) {
      let previous = 0;
      for (let minutes = 5; minutes <= 900; minutes += 5) {
        const badness = gapBadness(minutes, shape);
        expect(badness).toBeGreaterThanOrEqual(previous);
        expect(badness).toBeLessThanOrEqual(GAP_BADNESS_CAP);
        previous = badness;
      }
      // Strictly rising through the range real schedules actually occupy.
      expect(gapBadness(240, shape)).toBeGreaterThan(gapBadness(120, shape));
    }
  });

  it('never prefers creating a gap over closing it, however long the alternative gap would be', () => {
    // 8am-10am, 10am-12pm: back-to-back, no gap at all.
    const backToBack = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 600)])], []),
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 600, 720)])], []),
    ]);
    // 8am-10am, 6pm-8pm: same first class, but the second sits after an 8-hour dead gap.
    const bigGap = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 600)])], []),
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 1080, 1200)])], []),
    ]);
    const prefs: Prefs = { ...DEFAULT_PREFS, gaps: 1 };
    const backToBackScore = computeScore(backToBack, buildFullSelection(backToBack), prefs, emptyAssignment());
    const bigGapScore = computeScore(bigGap, buildFullSelection(bigGap), prefs, emptyAssignment());

    expect(backToBackScore.terms.find((t) => t.key === 'gaps')?.cost).toBe(0);
    expect(bigGapScore.terms.find((t) => t.key === 'gaps')!.cost).toBeGreaterThan(0);
    expect(backToBackScore.total).toBeLessThan(bigGapScore.total);
  });

  it('still prefers one consolidated gap over two fragmented ones, but never below zero cost', () => {
    // 8am-10am, 10am-12pm, 6pm-8pm: back-to-back first two, one 6-hour gap before the third.
    const oneLongGap = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 600)])], []),
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 600, 720)])], []),
      subject('CC', [event('CC', 'CC', 'lecture', [slot('Po', 1080, 1200)])], []),
    ]);
    // 8am-10am, 12pm-2pm, 4pm-6pm: two 2-hour gaps, less total idle time than the 6-hour gap above.
    const twoMediumGaps = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 600)])], []),
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 720, 840)])], []),
      subject('CC', [event('CC', 'CC', 'lecture', [slot('Po', 960, 1080)])], []),
    ]);
    const prefs: Prefs = { ...DEFAULT_PREFS, gaps: 1 };
    const oneLongGapScore = computeScore(oneLongGap, buildFullSelection(oneLongGap), prefs, emptyAssignment());
    const twoMediumGapsScore = computeScore(twoMediumGaps, buildFullSelection(twoMediumGaps), prefs, emptyAssignment());

    // Consolidating into one long gap still costs less than splitting into two medium ones
    // (each hit hard by the same climbing part of the curve) — but both cost strictly more
    // than a back-to-back schedule would, which the bug-fix test above nails down directly.
    expect(oneLongGapScore.terms.find((t) => t.key === 'gaps')?.cost).toBeLessThan(
      twoMediumGapsScore.terms.find((t) => t.key === 'gaps')!.cost,
    );
    expect(oneLongGapScore.terms.find((t) => t.key === 'gaps')!.cost).toBeGreaterThan(0);
  });
});

describe('computeScore — break shape slider', () => {
  /** Same day, same total idle time, split two ways: one 3h hole against three 1h breathers. */
  const oneLongBreak = timetableOf([
    subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 540)])], []),
    subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 720, 780)])], []),
  ]);
  const shortBreathers = timetableOf([
    subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 540)])], []),
    subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 600, 660)])], []),
    subject('CC', [event('CC', 'CC', 'lecture', [slot('Po', 720, 780)])], []),
    subject('DD', [event('DD', 'DD', 'lecture', [slot('Po', 840, 900)])], []),
  ]);

  const gapCost = (timetable: ReturnType<typeof timetableOf>, gapShape: number) =>
    computeScore(timetable, buildFullSelection(timetable), { ...DEFAULT_PREFS, gaps: 1, gapShape }, emptyAssignment())
      .terms.find((t) => t.key === 'gaps')!.cost;

  it('prefers one consolidated break at the "one long break" end', () => {
    expect(gapCost(oneLongBreak, 0)).toBeLessThan(gapCost(shortBreathers, 0));
  });

  it('prefers several short breathers at the "several short breaks" end', () => {
    expect(gapCost(shortBreathers, 1)).toBeLessThan(gapCost(oneLongBreak, 1));
  });

  it('makes short gaps steadily cheaper and consolidation steadily less attractive as it rises', () => {
    let previousShort = Infinity;
    for (const shape of [0, 0.25, 0.5, 0.75, 1]) {
      const short = gapBadness(60, shape); // 30 chargeable minutes, the free window taken off
      expect(short).toBeLessThan(previousShort); // a short breather only ever gets cheaper
      previousShort = short;
    }
  });

  it('still consolidates a genuinely long stretch at every slider position — the per-gap cap sees to it', () => {
    // The example that started this: one 6-hour hole beats the same idle time split into 2-hour
    // holes regardless of taste, because a single gap can never cost more than the cap.
    for (const shape of [0, 0.25, 0.5, 0.75, 1]) {
      const consolidated = gapBadness(360, shape);
      const fragmented = 3 * gapBadness(120, shape);
      expect(consolidated).toBeLessThan(fragmented);
    }
  });

  it('is inert when dead time is not scored at all', () => {
    const at0 = computeScore(shortBreathers, buildFullSelection(shortBreathers), { ...DEFAULT_PREFS, gaps: 0, gapShape: 0 }, emptyAssignment());
    const at1 = computeScore(shortBreathers, buildFullSelection(shortBreathers), { ...DEFAULT_PREFS, gaps: 0, gapShape: 1 }, emptyAssignment());
    expect(at0.total).toBe(at1.total);
  });
});

describe('computeScore — the free changeover window', () => {
  it('charges nothing for a gap at or under the free window, at any break shape', () => {
    for (const shape of [0, 0.5, 1]) {
      expect(gapBadness(10, shape)).toBe(0); // the :00-:50 hour grid's own changeover
      expect(gapBadness(GAP_FREE_MINUTES, shape)).toBe(0);
      expect(gapBadness(GAP_FREE_MINUTES + 1, shape)).toBeGreaterThan(0);
    }
  });

  it('measures a longer gap from the end of the free window, not from zero', () => {
    expect(chargeableGapMinutes(90)).toBe(60);
    expect(chargeableGapMinutes(10)).toBe(0);
    // A 90-minute gap is scored as exactly an hour of dead time.
    expect(gapBadness(90, 0.5)).toBeCloseTo(gapBadness(60 + GAP_FREE_MINUTES, 0.5));
  });

  it('leaves a back-to-back day on the university hour grid completely free of dead time', () => {
    // 08:00-08:50, 09:00-09:50, 10:00-10:50: consecutive teaching hours, two 10-minute changeovers.
    const timetable = timetableOf([
      subject('AA', [event('AA', 'AA', 'lecture', [slot('Po', 480, 530)])], []),
      subject('BB', [event('BB', 'BB', 'lecture', [slot('Po', 540, 590)])], []),
      subject('CC', [event('CC', 'CC', 'lecture', [slot('Po', 600, 650)])], []),
    ]);
    const score = computeScore(timetable, buildFullSelection(timetable), { ...DEFAULT_PREFS, gaps: 1 }, emptyAssignment());
    const gaps = score.terms.find((t) => t.key === 'gaps')!;
    expect(gaps.cost).toBe(0);
    // The idle minutes are still reported — they just aren't charged for.
    expect(gaps.detail).toBe('20 idle minute(s) in 2 gap(s), 0 over 30 min');
  });
});

describe('computeScore — barely-used days', () => {
  const dayWith = (day: Slot['day'], minutes: number) =>
    subject(`S${day}${minutes}`, [event(`S${day}${minutes}`, `S${day}${minutes}`, 'lecture', [slot(day, 480, 480 + minutes)])], []);

  const sparseCost = (subjects: ReturnType<typeof dayWith>[], prefs = DEFAULT_PREFS) => {
    const timetable = timetableOf(subjects);
    return computeScore(timetable, buildFullSelection(timetable), prefs, emptyAssignment()).terms.find(
      (t) => t.key === 'sparseDay',
    )!;
  };

  it('charges nothing for a day that carries a full load', () => {
    expect(sparseCost([dayWith('Po', 240)]).cost).toBe(0);
    expect(sparseCost([dayWith('Po', 400)]).cost).toBe(0);
  });

  it('charges more the emptier the day is', () => {
    const nearlyFull = sparseCost([dayWith('Po', 200)]).cost;
    const half = sparseCost([dayWith('Po', 120)]).cost;
    const lone = sparseCost([dayWith('Po', 50)]).cost;
    expect(nearlyFull).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(nearlyFull);
    expect(lone).toBeGreaterThan(half);
    expect(lone).toBeLessThan(WEIGHTS.sparseDayFullyEmpty);
  });

  it('is on at the neutral default, so a lone seminar day costs something without touching a slider', () => {
    expect(DEFAULT_PREFS.compactness).toBe(0);
    expect(sparseCost([dayWith('Po', 110)]).cost).toBeGreaterThan(0);
  });

  it('prefers merging two half-days into one full day', () => {
    const split = sparseCost([dayWith('Po', 120), dayWith('Út', 120)]).cost;
    const merged = sparseCost([dayWith('Po', 240)]).cost;
    expect(merged).toBeLessThan(split);
  });

  it('fades out as the compactness slider moves toward spread, and is gone at full spread', () => {
    const day = [dayWith('Po', 110)];
    const neutral = sparseCost(day, { ...DEFAULT_PREFS, compactness: 0 }).cost;
    const halfSpread = sparseCost(day, { ...DEFAULT_PREFS, compactness: -0.5 }).cost;
    const fullSpread = sparseCost(day, { ...DEFAULT_PREFS, compactness: -1 });
    expect(halfSpread).toBeLessThan(neutral);
    expect(halfSpread).toBeGreaterThan(0);
    expect(fullSpread.cost).toBe(0);
    expect(fullSpread.detail).toBe('spread: ignored');
  });

  it('does not fade on the cram side — cram wants full days too', () => {
    const day = [dayWith('Po', 110)];
    expect(sparseCost(day, { ...DEFAULT_PREFS, compactness: 1 }).cost).toBe(
      sparseCost(day, { ...DEFAULT_PREFS, compactness: 0 }).cost,
    );
  });

  it('beats the gap it would have to create to consolidate a lone class', () => {
    // The bug this term exists for: a lone 110-minute day, versus merging it onto another day
    // at the cost of a gap. Merging must win.
    const lonely = sparseCost([dayWith('Po', 200), dayWith('Út', 110)]).cost;
    const merged = sparseCost([dayWith('Po', 200)]).cost;
    expect(lonely - merged).toBeGreaterThan(gapBadness(90, DEFAULT_PREFS.gapShape) * DEFAULT_PREFS.gaps * WEIGHTS.gapsPerIdleMinute);
  });
});

describe('gapExponent', () => {
  it('rises monotonically across the slider and clamps outside 0..1', () => {
    expect(gapExponent(0)).toBeLessThan(gapExponent(0.5));
    expect(gapExponent(0.5)).toBeLessThan(gapExponent(1));
    expect(gapExponent(-5)).toBe(gapExponent(0));
    expect(gapExponent(5)).toBe(gapExponent(1));
  });

  it('is geometrically centred, so the midpoint sits between the two extremes', () => {
    expect(gapExponent(0.5)).toBeCloseTo(Math.sqrt(gapExponent(0) * gapExponent(1)));
  });
});

describe('computeScore — day window', () => {
  it('penalises minutes scheduled outside the requested window, per minute', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]); // 08:00-09:30
    const timetable = timetableOf([subject('AA', [a], [])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, dayWindow: { start: 600, end: 1200 } }; // nothing before 10:00
    const score = computeScore(timetable, selection, prefs, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'dayWindow')?.cost).toBe(120 * WEIGHTS.dayWindowPerMinuteOutside);
  });
});

describe('computeScore — max classes per day', () => {
  it('is off by default', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 600, 690)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, DEFAULT_PREFS, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'maxPerDay')?.cost).toBe(0);
  });

  it('charges per class beyond the cap on any single day', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 600, 690)]);
    const c = event('CC', 'CC', 'lecture', [slot('Po', 700, 790)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], []), subject('CC', [c], [])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, maxClassesPerDay: 2 };
    const score = computeScore(timetable, selection, prefs, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'maxPerDay')?.cost).toBe(1 * WEIGHTS.maxPerDayPerExcessClass);
  });
});

describe('computeScore — priority ordering', () => {
  it('a single seminar collision always outranks even a maximally-bad comfort schedule', () => {
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01'); // overlaps CC/01
    const timetable = timetableOf([subject('CC', [], [seminarC]), subject('DD', [], [seminarD])]);
    const selection = buildFullSelection(timetable);

    const withCollision = computeScore(timetable, selection, DEFAULT_PREFS, {
      seminarChoice: { CC: 'CC/01', DD: 'DD/01' },
      droppedLectures: new Set(),
    });
    const worstComfortOnly = computeScore(
      timetable,
      selection,
      { ...DEFAULT_PREFS, compactness: 1, gaps: 1, maxClassesPerDay: 0 },
      { seminarChoice: { CC: 'CC/01' }, droppedLectures: new Set() },
    );

    expect(withCollision.total).toBeGreaterThan(worstComfortOnly.total);
  });

  it('a dropped ★-less lecture outranks comfort preferences but not a collision', () => {
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01');
    const lecture = event('EE', 'EE', 'lecture', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('CC', [], [seminarC]), subject('DD', [], [seminarD]), subject('EE', [lecture], [])]);
    const selection = buildFullSelection(timetable);
    const busyPrefs: Prefs = { ...DEFAULT_PREFS, compactness: 1, gaps: 1, maxClassesPerDay: 0 };

    const withCollision = computeScore(timetable, selection, DEFAULT_PREFS, {
      seminarChoice: { CC: 'CC/01', DD: 'DD/01' },
      droppedLectures: new Set(),
    });
    const withDroppedLecture = computeScore(timetable, selection, busyPrefs, {
      seminarChoice: { CC: 'CC/01' },
      droppedLectures: new Set(['EE']),
    });
    const comfortOnly = computeScore(timetable, selection, busyPrefs, {
      seminarChoice: { CC: 'CC/01' },
      droppedLectures: new Set(),
    });

    expect(withCollision.total).toBeGreaterThan(withDroppedLecture.total);
    expect(withDroppedLecture.total).toBeGreaterThan(comfortOnly.total);
  });
});
