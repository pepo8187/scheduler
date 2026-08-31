import { useMemo } from 'react';
import { DAY_ORDER } from '../../domain/format';
import { slotsOverlap, type Overlap } from '../../domain/overlap';
import type { SwitchCost } from '../../domain/switching';
import type { CourseEvent, Day, Selection, Slot, Solution, Timetable } from '../../domain/types';
import DayRow from './DayRow';
import type { DayBlockInfo } from './gridTypes';
import HourRuler from './HourRuler';
import Legend from './Legend';

const WEEKDAYS = DAY_ORDER.slice(0, 5);

function collisionKindForSlot(event: CourseEvent, slot: Slot, overlaps: Overlap[]): DayBlockInfo['collisionKind'] {
  let kind: DayBlockInfo['collisionKind'];
  for (const overlap of overlaps) {
    const other = overlap.a.id === event.id ? overlap.b : overlap.b.id === event.id ? overlap.a : null;
    if (!other) continue;
    if (!other.slots.some((s) => slotsOverlap(slot, s))) continue;
    if (overlap.kind === 'seminar') return 'seminar'; // most severe: short-circuit
    kind = 'lecture-lecture';
  }
  return kind;
}

interface WeekGridProps {
  timetable: Timetable;
  selection: Selection;
  solution: Solution | null;
  /** What every unchosen group would cost, priced once per solve in `App`. */
  costs: Map<string, SwitchCost>;
  /** Clicking a ghost chooses that group — the payoff of `pinned` existing at all. */
  onPin: (subjectCode: string, seminarId: string) => void;
}

export default function WeekGrid({ timetable, selection, solution, costs, onPin }: WeekGridProps) {
  const subjectNames = useMemo(() => new Map(timetable.subjects.map((s) => [s.code, s.name])), [timetable]);

  const blocksByDay = useMemo(() => {
    const byDay = new Map<Day, DayBlockInfo[]>();
    if (!solution) return byDay;
    for (const event of solution.events) {
      for (const slot of event.slots) {
        const list = byDay.get(slot.day) ?? [];
        list.push({
          event,
          slot,
          subjectName: subjectNames.get(event.subjectCode) ?? event.subjectCode,
          collisionKind: collisionKindForSlot(event, slot, solution.overlaps),
          pinned: selection[event.subjectCode]?.pinned?.[event.id] ?? false,
        });
        byDay.set(slot.day, list);
      }
    }
    return byDay;
  }, [solution, subjectNames, selection]);

  // Unselected candidate groups: enabled but not chosen, rendered as faint outlines
  // so it stays visible what the optimizer passed over.
  const ghostsByDay = useMemo(() => {
    const byDay = new Map<Day, DayBlockInfo[]>();
    if (!solution) return byDay;
    for (const subject of timetable.subjects) {
      const subjectSelection = selection[subject.code];
      if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;
      const chosenId = solution.assignment.seminarChoice[subject.code];
      for (const seminar of subject.seminars) {
        if (seminar.id === chosenId || !subjectSelection.seminars[seminar.id]) continue;
        if (subjectSelection.reclassified[seminar.id]) continue; // fixed as a lecture, not a candidate
        for (const slot of seminar.slots) {
          const list = byDay.get(slot.day) ?? [];
          list.push({ event: seminar, slot, subjectName: subject.name, switchCost: costs.get(seminar.id) });
          byDay.set(slot.day, list);
        }
      }
    }
    return byDay;
  }, [solution, selection, timetable, costs]);

  return (
    <div className="week-grid">
      <HourRuler minHour={timetable.minHour} maxHour={timetable.maxHour} hours={timetable.hours} />
      <div className="week-grid__days">
        {WEEKDAYS.map((day) => (
          <DayRow
            key={day}
            day={day}
            minHour={timetable.minHour}
            maxHour={timetable.maxHour}
            hours={timetable.hours}
            blocks={blocksByDay.get(day) ?? []}
            ghostBlocks={ghostsByDay.get(day) ?? []}
            onPin={onPin}
          />
        ))}
      </div>
      <Legend />
    </div>
  );
}
