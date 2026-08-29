import type { CourseEvent, Day } from './types';

/** Parses "H:MM" or "HH:MM" into minutes from midnight. */
export function parseTimeToMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Formats minutes from midnight as "HH:MM". */
export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Mon-Fri, the only days the app schedules into. */
export const DAY_ORDER: Day[] = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

/** Full English weekday names, used in preference and diagnostics copy. */
export const DAY_LABELS: Record<Day, string> = {
  Po: 'Monday',
  Út: 'Tuesday',
  St: 'Wednesday',
  Čt: 'Thursday',
  Pá: 'Friday',
  So: 'Saturday',
  Ne: 'Sunday',
};

/** "Po 08:00-09:40, St 16:00-17:40" — one comma-joined line per event's weekly slots. */
export function describeSlots(event: CourseEvent): string {
  return event.slots.map((slot) => `${slot.day} ${formatMinutes(slot.start)}-${formatMinutes(slot.end)}`).join(', ');
}

/** Comma-joined, de-duplicated teacher names across an event's slots. */
export function describeTeachers(event: CourseEvent): string {
  return event.teachers.map((t) => t.name).join(', ');
}

/** Comma-joined, de-duplicated room names across an event's slots. */
export function describeRooms(event: CourseEvent): string {
  const rooms = new Set<string>();
  for (const slot of event.slots) for (const room of slot.rooms) rooms.add(room);
  return [...rooms].join(', ');
}
