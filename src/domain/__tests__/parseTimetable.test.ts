import { describe, expect, it } from 'vitest';
import { findOverlaps } from '../overlap';
import { parseTimetable } from '../parseTimetable';
import type { CourseEvent, Subject } from '../types';
import { readSampleXml } from './sample';

function bySubject(subjects: Subject[]): Record<string, Subject> {
  return Object.fromEntries(subjects.map((s) => [s.code, s]));
}

function groups(events: CourseEvent[]): (string | undefined)[] {
  return events.map((e) => e.group).sort();
}

describe('parseTimetable', () => {
  const parse = () => parseTimetable(readSampleXml());

  it('exposes the structural grid bounds and a 12-row hour ruler', () => {
    const timetable = parse();
    expect(timetable.minHour).toBe(480);
    expect(timetable.maxHour).toBe(1200);
    expect(timetable.hours).toHaveLength(12);
    expect(timetable.hours[0]).toEqual({ start: 480, end: 530 });
    expect(timetable.hours[11]).toEqual({ start: 1140, end: 1190 });
  });

  it('parses exactly the 9 subjects from the sample, each with the right lecture/seminar split', () => {
    const { subjects } = parse();
    expect(subjects).toHaveLength(9);
    expect(subjects.map((s) => s.code).sort()).toEqual(
      ['IB111', 'MB154', 'MB152', 'M1100', 'PV275', 'M1110', 'VV028', 'VB005', 'PB006'].sort(),
    );

    const byCode = bySubject(subjects);

    // PV275: a forced choice, exactly one group.
    expect(byCode.PV275?.lectures).toHaveLength(1);
    expect(groups(byCode.PV275?.seminars ?? [])).toEqual(['01']);

    // IB111: lecture plus 31 seminar groups (numbered 01-32, skipping 23).
    expect(byCode.IB111?.lectures).toHaveLength(1);
    expect(groups(byCode.IB111?.seminars ?? [])).toHaveLength(31);

    // MB154, MB152, M1100, M1110: lecture plus several seminar groups.
    expect(groups(byCode.MB154?.seminars ?? [])).toEqual(['01', '02', '03', '04', '05']);
    expect(groups(byCode.MB152?.seminars ?? [])).toEqual(['01', '02', '03', '04', '05', '06']);
    expect(groups(byCode.M1100?.seminars ?? [])).toEqual(['01', '02', '03', '04', '05']);
    expect(groups(byCode.M1110?.seminars ?? [])).toEqual(['01', '02', '03', '04', '05']);

    // VV028, VB005, PB006: lecture only, no seminar groups.
    for (const code of ['VV028', 'VB005', 'PB006']) {
      expect(byCode[code]?.lectures).toHaveLength(1);
      expect(byCode[code]?.seminars).toHaveLength(0);
    }

    // This export doesn't happen to carry a seminar-only subject (a language class with
    // groups but no lecture) — the format supports it, this particular sample just has none.
    expect(subjects.every((s) => s.lectures.length > 0)).toBe(true);
  });

  it('de-duplicates the once-per-teaching-week repeated rooms and teachers on a slot', () => {
    const { subjects } = parse();
    const byCode = bySubject(subjects);
    const mb152Lecture = byCode.MB152?.lectures[0];

    expect(mb152Lecture?.slots).toHaveLength(1);
    expect(mb152Lecture?.slots[0]?.rooms).toEqual(['D1']);
    expect(mb152Lecture?.teachers).toEqual([{ id: '78392', name: 'M. Veselý' }]);
  });

  it('reads day, time and content for a known slot (PV275 lecture, Út 10:00-11:50)', () => {
    const { subjects } = parse();
    const lecture = bySubject(subjects).PV275?.lectures[0];

    expect(lecture?.id).toBe('PV275');
    expect(lecture?.slots).toHaveLength(1);
    expect(lecture?.slots[0]).toMatchObject({ day: 'Út', start: 600, end: 710, rooms: ['B411'] });
  });

  it('extracts the nezname courses that must never be placed on the grid', () => {
    const { unscheduled } = parse();
    expect(unscheduled).toHaveLength(16);
    expect(unscheduled.every((c) => /^IB111\/\d+_nahrada$/.test(c.code))).toBe(true);
    expect(unscheduled[0]?.name).toBe('Základy programování');
  });

  it('has no lecture-lecture overlaps of its own', () => {
    const { subjects } = parse();
    const allLectures = subjects.flatMap((s) => s.lectures);
    expect(findOverlaps(allLectures)).toHaveLength(0);
  });

  it('gives every seminar group all-or-nothing slots merged under one CourseEvent id', () => {
    const { subjects } = parse();
    const pv275Group1 = bySubject(subjects).PV275?.seminars.find((s) => s.group === '01');
    expect(pv275Group1?.id).toBe('PV275/01');
    expect(pv275Group1?.slots).toHaveLength(1);
    expect(pv275Group1?.slots[0]).toMatchObject({ day: 'Út', start: 960, end: 1070 });
  });
});

describe('parseTimetable — group labels that are not purely numeric', () => {
  function minimalDoc(kod: string): string {
    return `<?xml version="1.0"?>
<rozvrh>
<minhod>480</minhod>
<maxhod>600</maxhod>
<hodiny><hodina><od>8:00</od><do>8:50</do></hodina></hodiny>
<tabulka>
<den id="Po" rows="1">
<radek num="1">
	<slot pdiff="0" diff="10" odcas="08:00" docas="08:50">
		<mistnosti></mistnosti>
		<akce><kod>${kod}</kod><nazev>Test subject</nazev><predmetid>1</predmetid><fakulta_url>fi</fakulta_url><obdobi_url>p</obdobi_url></akce>
		<ucitele></ucitele>
	</slot>
</radek>
</den>
</tabulka>
</rozvrh>`;
  }

  it('treats a letter-only group label (IB000/AA) as a seminar of IB000, not its own lecture', () => {
    const { subjects } = parseTimetable(minimalDoc('IB000/AA'));
    expect(subjects).toHaveLength(1);
    expect(subjects[0]?.code).toBe('IB000');
    expect(subjects[0]?.lectures).toHaveLength(0);
    expect(subjects[0]?.seminars).toHaveLength(1);
    expect(subjects[0]?.seminars[0]).toMatchObject({ id: 'IB000/AA', subjectCode: 'IB000', kind: 'seminar', group: 'AA' });
  });

  it('treats a lowercase-word group label (PB173/git) as a seminar too', () => {
    const { subjects } = parseTimetable(minimalDoc('PB173/git'));
    expect(subjects[0]?.code).toBe('PB173');
    expect(subjects[0]?.seminars).toHaveLength(1);
    expect(subjects[0]?.seminars[0]?.group).toBe('git');
  });

  it('still treats a slash-free code as a lecture', () => {
    const { subjects } = parseTimetable(minimalDoc('IB000'));
    expect(subjects[0]?.lectures).toHaveLength(1);
    expect(subjects[0]?.seminars).toHaveLength(0);
  });
});
