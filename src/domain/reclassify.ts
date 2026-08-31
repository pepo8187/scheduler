import type { CourseEvent } from './types';

/**
 * A shallow clone with `kind` flipped to 'lecture'. Everything downstream that reads `.kind` —
 * overlap classification, grid styling — then treats a reclassified seminar exactly like a real
 * lecture, without mutating the parsed timetable that other views (the seminar list, teacher
 * chips) still read `kind: 'seminar'` from.
 */
export function asLecture(event: CourseEvent): CourseEvent {
  return { ...event, kind: 'lecture' };
}
