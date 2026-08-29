import { parseTimeToMinutes } from './format';
import type { CourseEvent, Day, EventKind, Slot, Subject, Teacher, Timetable, UnscheduledCourse } from './types';

/**
 * `MA012` is a lecture; `MA012/03` is seminar group `03` of `MA012`. The group label after
 * the slash isn't always numeric — `IB000/AA` (advanced), `PB173/qt`, `PB173/git` are all
 * real MUNI IS group labels — so any `/` marks a seminar group, not just a digit-led one.
 */
const SEMINAR_CODE = /^(.+?)\/(.+)$/;

export function parseTimetable(xml: string): Timetable {
  return parseTimetableDocument(new DOMParser().parseFromString(xml, 'application/xml'));
}

interface RawEvent {
  kod: string;
  nazev: string;
  subjectId: string;
  facultyUrl: string;
  periodUrl: string;
  slots: Slot[];
  teachers: Map<string, Teacher>;
}

export function parseTimetableDocument(doc: Document): Timetable {
  const root = doc.documentElement;
  const minHour = Number(childText(root, 'minhod'));
  const maxHour = Number(childText(root, 'maxhod'));

  const hours = [...doc.querySelectorAll('hodiny > hodina')].map((hodina) => ({
    start: parseTimeToMinutes(childText(hodina, 'od') ?? ''),
    end: parseTimeToMinutes(childText(hodina, 'do') ?? ''),
  }));

  const notes = new Map<string, string>();
  for (const poznamka of doc.querySelectorAll('poznamky > poznamka')) {
    const id = poznamka.getAttribute('id');
    if (id) notes.set(id, poznamka.textContent ?? '');
  }

  // Slots sharing a `kod` merge into one CourseEvent: picking a group means
  // attending all of its weekly meetings, so every occurrence across every
  // <den>/<radek> must accumulate into the same event.
  const rawEvents = new Map<string, RawEvent>();

  for (const slotEl of doc.querySelectorAll('tabulka den slot')) {
    const day = (slotEl.closest('den')?.getAttribute('id') ?? '') as Day;
    const start = parseTimeToMinutes(slotEl.getAttribute('odcas') ?? '');
    const end = parseTimeToMinutes(slotEl.getAttribute('docas') ?? '');

    const rooms = dedupeById(
      slotEl.querySelectorAll('mistnosti > mistnost'),
      (mistnost) => childText(mistnost, 'mistnostid'),
      (mistnost) => childText(mistnost, 'mistnostozn') ?? '',
    );

    const teachers = new Map<string, Teacher>();
    for (const ucitel of slotEl.querySelectorAll('ucitele > ucitel')) {
      const id = childText(ucitel, 'ucitelid');
      const name = childText(ucitel, 'uciteljmeno') ?? '';
      if (id) teachers.set(id, { id, name });
    }

    const akce = slotEl.querySelector('akce');
    const kod = childText(akce, 'kod') ?? '';
    const noteId = slotEl.querySelector('poznamka')?.getAttribute('id') ?? undefined;

    const slot: Slot = {
      day,
      start,
      end,
      rooms,
      teachers: [...teachers.values()],
      noteId,
      note: noteId ? notes.get(noteId) : undefined,
    };

    let raw = rawEvents.get(kod);
    if (!raw) {
      raw = {
        kod,
        nazev: childText(akce, 'nazev') ?? '',
        subjectId: childText(akce, 'predmetid') ?? '',
        facultyUrl: childText(akce, 'fakulta_url') ?? '',
        periodUrl: childText(akce, 'obdobi_url') ?? '',
        slots: [],
        teachers: new Map(),
      };
      rawEvents.set(kod, raw);
    }
    raw.slots.push(slot);
    for (const teacher of teachers.values()) raw.teachers.set(teacher.id, teacher);
  }

  const subjects = new Map<string, Subject>();
  for (const raw of rawEvents.values()) {
    const match = raw.kod.match(SEMINAR_CODE);
    const kind: EventKind = match ? 'seminar' : 'lecture';
    const subjectCode = match ? match[1]! : raw.kod;
    const group = match ? match[2] : undefined;

    const courseEvent: CourseEvent = {
      id: raw.kod,
      subjectCode,
      kind,
      group,
      slots: raw.slots,
      teachers: [...raw.teachers.values()],
    };

    let subject = subjects.get(subjectCode);
    if (!subject) {
      subject = {
        code: subjectCode,
        name: raw.nazev,
        subjectId: raw.subjectId,
        facultyUrl: raw.facultyUrl,
        periodUrl: raw.periodUrl,
        lectures: [],
        seminars: [],
      };
      subjects.set(subjectCode, subject);
    }
    (kind === 'lecture' ? subject.lectures : subject.seminars).push(courseEvent);
  }

  const unscheduled: UnscheduledCourse[] = [...doc.querySelectorAll('nezname > akce')].map((akce) => ({
    code: childText(akce, 'kod') ?? '',
    name: childText(akce, 'nazev') ?? '',
    subjectId: childText(akce, 'predmetid') ?? '',
    facultyUrl: childText(akce, 'fakulta_url') ?? '',
    periodUrl: childText(akce, 'obdobi_url') ?? '',
  }));

  return { minHour, maxHour, hours, subjects: [...subjects.values()], unscheduled };
}

function childText(el: Element | null, tag: string): string | null {
  return el?.querySelector(tag)?.textContent ?? null;
}

/** Collapses repeated weekly copies (identical id, 12x) down to one value per id. */
function dedupeById(
  items: Iterable<Element>,
  idOf: (item: Element) => string | null,
  valueOf: (item: Element) => string,
): string[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    const id = idOf(item);
    if (id && !seen.has(id)) seen.set(id, valueOf(item));
  }
  return [...seen.values()];
}
