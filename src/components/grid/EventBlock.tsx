import { describeTeachers, formatMinutes } from '../../domain/format';
import type { CourseEvent, Slot } from '../../domain/types';

export type CollisionKind = 'lecture-lecture' | 'seminar';

interface EventBlockProps {
  event: CourseEvent;
  subjectName: string;
  slot: Slot;
  minHour: number;
  maxHour: number;
  top: number;
  height: number;
  collisionKind?: CollisionKind;
  ghost?: boolean;
}

export default function EventBlock({
  event,
  subjectName,
  slot,
  minHour,
  maxHour,
  top,
  height,
  collisionKind,
  ghost,
}: EventBlockProps) {
  const total = maxHour - minHour;
  const left = ((slot.start - minHour) / total) * 100;
  const width = ((slot.end - slot.start) / total) * 100;

  const classNames = [
    'event-block',
    event.kind === 'lecture' ? 'event-block--lecture' : 'event-block--seminar',
    collisionKind === 'lecture-lecture' && 'event-block--clash-lecture',
    collisionKind === 'seminar' && 'event-block--clash-seminar',
    ghost && 'event-block--ghost',
  ]
    .filter(Boolean)
    .join(' ');

  const rooms = slot.rooms.join(', ');
  const teachers = describeTeachers(event);

  return (
    <div
      className={classNames}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
      title={`${event.id} ${subjectName}\n${formatMinutes(slot.start)}-${formatMinutes(slot.end)}${teachers ? `\n${teachers}` : ''}${rooms ? `\n${rooms}` : ''}`}
    >
      {!ghost && (
        <>
          {collisionKind && (
            <span className="event-block__warning" aria-hidden="true">
              ⚠
            </span>
          )}
          <span className="event-block__code">{event.id}</span>
          <span className="event-block__name">{subjectName}</span>
          {teachers && <span className="event-block__teacher">{teachers}</span>}
          {rooms && <span className="event-block__room">{rooms}</span>}
        </>
      )}
    </div>
  );
}
