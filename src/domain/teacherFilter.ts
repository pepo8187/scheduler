import type { CourseEvent } from './types';

/** The seminar groups a given teacher teaches, by CourseEvent id. */
export function seminarIdsForTeacher(seminars: CourseEvent[], teacherId: string): string[] {
  return seminars.filter((s) => s.teachers.some((t) => t.id === teacherId)).map((s) => s.id);
}

/** True when nothing has been narrowed away yet: every one of the subject's groups is enabled. */
export function isUnfiltered(seminars: CourseEvent[], enabled: Record<string, boolean>): boolean {
  return seminars.length > 0 && seminars.every((s) => enabled[s.id]);
}

/**
 * Decides what a click on a teacher chip does. Pure so the rule can be tested without a DOM.
 *
 * Narrowing to one teacher used to mean clicking away every other teacher in turn, which is the
 * long way round for what is almost always the first thing you want. So the first click out of
 * the unfiltered state is *exclusive* — it keeps that teacher's groups and drops the rest — and
 * every click after it is *additive*, building up the combination one teacher at a time.
 *
 * Clicking a teacher whose groups are already fully selected removes them again. If that would
 * leave the subject with no group at all, the filter clears back to unfiltered instead: an empty
 * subject can't be scheduled, and "undo my filter" is what that last click actually means.
 *
 * Groups shared between teachers belong to each of them, so adding one teacher can bring back a
 * group another teacher also teaches, and removing one can take it away. That follows from the
 * export's own data rather than anything decided here.
 */
export function applyTeacherChipClick(
  seminars: CourseEvent[],
  enabled: Record<string, boolean>,
  teacherId: string,
): Record<string, boolean> {
  const teacherIds = seminarIdsForTeacher(seminars, teacherId);
  if (teacherIds.length === 0) return enabled;

  const all = (value: boolean) => Object.fromEntries(seminars.map((s) => [s.id, value]));

  // First click out of the pristine state: keep only this teacher's groups.
  if (isUnfiltered(seminars, enabled)) {
    const next = all(false);
    for (const id of teacherIds) next[id] = true;
    return next;
  }

  const next = { ...enabled };
  const fullySelected = teacherIds.every((id) => enabled[id]);
  for (const id of teacherIds) next[id] = !fullySelected;

  // Removing the last active teacher clears the filter rather than leaving nothing to schedule.
  if (fullySelected && seminars.every((s) => !next[s.id])) return all(true);

  return next;
}
