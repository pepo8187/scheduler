import { describeTeachers, formatMinutes } from '../../domain/format';
import { describeParity, PARITY_LABEL } from '../../domain/parity';
import { describeSwitchCost, switchTier, type SwitchCost } from '../../domain/switching';
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
  /** Ghosts only: what taking this group would cost, priced by `WeekGrid`. */
  switchCost?: SwitchCost;
  /** Scheduled blocks only: the user chose this group, so the optimizer left it alone. */
  pinned?: boolean;
  /** Makes the block a button. Ghosts use it to pin the group they stand for. */
  onActivate?: () => void;
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
  switchCost,
  pinned,
  onActivate,
}: EventBlockProps) {
  const total = maxHour - minHour;
  const left = ((slot.start - minHour) / total) * 100;
  const width = ((slot.end - slot.start) / total) * 100;

  const classNames = [
    'event-block',
    event.kind === 'lecture' ? 'event-block--lecture' : 'event-block--seminar',
    collisionKind === 'lecture-lecture' && 'event-block--clash-lecture',
    collisionKind === 'seminar' && 'event-block--clash-seminar',
    slot.parity && `event-block--${slot.parity}`,
    ghost && 'event-block--ghost',
    // A ghost row can run to dozens of strips. Ranking them by what they'd cost is what makes
    // it readable: the free swaps stand out, the ones that would collide recede.
    ghost && switchCost && `event-block--ghost-${switchTier(switchCost)}`,
    pinned && 'event-block--pinned',
    onActivate && 'event-block--actionable',
  ]
    .filter(Boolean)
    .join(' ');

  const rooms = slot.rooms.join(', ');
  const teachers = describeTeachers(event);
  // The note is the export's own wording for an alternating-week slot ("každé liché
  // pondělí ..."), and is the authority behind the badge — worth showing verbatim on hover.
  // Rendered as text: a note can carry HTML anchor markup for room links.
  const cadence = describeParity(slot.parity);
  // The number that makes a ghost worth reading rather than merely visible.
  const cost = ghost && switchCost ? describeSwitchCost(switchCost) : '';

  const detail = `${event.id} ${subjectName}\n${formatMinutes(slot.start)}-${formatMinutes(slot.end)}${cadence ? ` — ${cadence}` : ''}${teachers ? `\n${teachers}` : ''}${rooms ? `\n${rooms}` : ''}${cost ? `\n\n${cost}` : ''}${onActivate ? '\nClick to choose this group' : ''}${pinned ? '\n\nYou chose this group — the optimizer is leaving it alone. Un-pin it in the sidebar.' : ''}${slot.note ? `\n\n${slot.note}` : ''}`;

  // A ghost that can be acted on is a real button, not a div with a click handler: it has to be
  // reachable by keyboard, and the ghost row is otherwise the one part of the grid that isn't.
  const Tag = onActivate ? 'button' : 'div';

  return (
    <Tag
      className={classNames}
      style={{ left: `${left}%`, width: `${width}%`, top, height }}
      title={detail}
      {...(onActivate ? { type: 'button' as const, onClick: onActivate, 'aria-label': detail } : {})}
    >
      {!ghost && (
        <>
          {pinned && (
            <span className="event-block__pin" aria-hidden="true">
              📌
            </span>
          )}
          {collisionKind && (
            <span className="event-block__warning" aria-hidden="true">
              ⚠
            </span>
          )}
          <span className="event-block__code">{event.id}</span>
          {slot.parity && (
            <span className="event-block__parity" title={cadence}>
              {PARITY_LABEL[slot.parity]}
            </span>
          )}
          <span className="event-block__name">{subjectName}</span>
          {teachers && <span className="event-block__teacher">{teachers}</span>}
          {rooms && <span className="event-block__room">{rooms}</span>}
        </>
      )}
    </Tag>
  );
}
