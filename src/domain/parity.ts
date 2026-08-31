import type { CourseEvent, Slot, WeekParity } from './types';

/**
 * Alternating-week (fortnightly) seminars.
 *
 * A MUNI export marks these only in prose, in the `<poznamky>` note a slot points at:
 * "každé liché pondělí 10:00–11:50" (every *odd* Monday) vs "každé sudé pondělí …" (every
 * *even* Monday). The parity is real scheduling information — IB015/05 and IB015/06 are the
 * same hour on alternating weeks, not two interchangeable groups — so it has to be read out
 * of the note before the rest of the domain can be right about anything.
 *
 * Two facts about the source data this module leans on, both verified against the podzim2022
 * export (40 notes, 79 noted slots):
 *
 *  - **Odd/even is one global fortnightly cycle, not a per-weekday phase.** Every date listed
 *    across every parity note falls in an ISO week of the stated parity, so an "odd Monday"
 *    and an "odd Thursday" are the same calendar week. That is what makes a single
 *    `'odd' | 'even'` flag sufficient; a per-day phase would need far more.
 *  - **The note agrees with the slot.** Every parity note names the weekday and time range of
 *    the slot carrying it, and all 79 match their slot's `den`/`odcas`/`docas` exactly. We
 *    therefore trust the note for parity and take day/time from the attributes as before.
 *
 * Not every note is about parity: a note may instead describe overflow rooms for part of the
 * semester, and carries HTML anchor markup when it does. Those parse to `undefined` and the
 * slot stays weekly — which is the governing rule of this whole module:
 *
 *   **Parity may only ever remove a constraint, never add one.**
 *
 * Anything unrecognised falls back to "meets every week". The failure mode is then a clash we
 * show that isn't real, never two classes we promise don't clash and do.
 */

/**
 * Czech adjective declension, spelled out rather than stem-matched. A bare `\blich\p{L}*`
 * stem also fires on unrelated words that merely start the same way — the surname "Sudová" in
 * a teacher note being the case that caught this — and a false parity is the one failure this
 * module must not have: it would silently delete a real collision.
 */
const CS_ENDINGS = '(?:ý|é|á|ého|ému|ém|ým|ou|ých|ými)';
// `\b` is ASCII-only even under /u, so it never fires after an accented letter — "liché "
// would not match. Letter lookaround is the unicode-correct way to say "whole word".
const NOT_LETTER_BEFORE = '(?<!\\p{L})';
const NOT_LETTER_AFTER = '(?!\\p{L})';
const ODD_CS = new RegExp(`${NOT_LETTER_BEFORE}lich${CS_ENDINGS}${NOT_LETTER_AFTER}`, 'iu');
const EVEN_CS = new RegExp(`${NOT_LETTER_BEFORE}sud${CS_ENDINGS}${NOT_LETTER_AFTER}`, 'iu');
/** MUNI IS also has an English UI; no English export was available to verify against. */
const ODD_EN = /\bodd\s+week/i;
const EVEN_EN = /\beven\s+week/i;

/**
 * Reads the alternating-week parity out of a note, or `undefined` for "every week".
 *
 * `undefined` covers all three uncertain cases deliberately: no note, a note about something
 * other than parity, and a note naming both parities (which we can't act on). Per the rule
 * above, all three mean "assume it meets weekly".
 */
export function parseNoteParity(note: string | undefined): WeekParity | undefined {
  if (!note) return undefined;
  const odd = ODD_CS.test(note) || ODD_EN.test(note);
  const even = EVEN_CS.test(note) || EVEN_EN.test(note);
  if (odd === even) return undefined; // neither, or contradictory
  return odd ? 'odd' : 'even';
}

/**
 * Whether two slots can ever land in the same calendar week.
 *
 * An unmarked (weekly) slot shares a week with everything, including both parities. Two
 * marked slots share a week only if they carry the same parity. This is the single predicate
 * that makes an odd-week class and an even-week class at the same hour a legal pair rather
 * than a collision.
 */
export function parityCanCoincide(a: WeekParity | undefined, b: WeekParity | undefined): boolean {
  return a === undefined || b === undefined || a === b;
}

/** True once anything here meets fortnightly — the flag that turns on two-week scoring. */
export function hasParity(events: CourseEvent[]): boolean {
  return events.some((event) => event.slots.some((slot) => slot.parity !== undefined));
}

/**
 * The events as actually lived in an odd (or even) week: slots of the opposite parity drop
 * out, and an event left with no slots that week drops out entirely.
 *
 * Returns the input array untouched when nothing is fortnightly, so the common case allocates
 * nothing — see `scoreResolved`.
 */
export function weekView(events: CourseEvent[], week: WeekParity): CourseEvent[] {
  if (!hasParity(events)) return events;
  const view: CourseEvent[] = [];
  for (const event of events) {
    const slots = event.slots.filter((slot) => (slot.parity ?? week) === week);
    if (slots.length === event.slots.length) view.push(event);
    else if (slots.length > 0) view.push({ ...event, slots });
  }
  return view;
}

/** "odd" / "even" — the short marker the grid and sidebar label a fortnightly slot with. */
export const PARITY_LABEL: Record<WeekParity, string> = { odd: 'odd', even: 'even' };

/** An event's parity when every one of its slots agrees; `undefined` if weekly or mixed. */
export function eventParity(event: CourseEvent): WeekParity | undefined {
  const first = event.slots[0]?.parity;
  if (first === undefined) return undefined;
  return event.slots.every((slot) => slot.parity === first) ? first : undefined;
}

/** "every odd week" — the phrase used in tooltips and group rows. */
export function describeParity(parity: WeekParity | undefined): string {
  return parity ? `every ${PARITY_LABEL[parity]} week` : '';
}

/** Slot-level convenience for the grid, which works in slots rather than events. */
export function slotsCanCoincide(a: Slot, b: Slot): boolean {
  return parityCanCoincide(a.parity, b.parity);
}
