import type { SwitchCost } from '../../domain/switching';
import type { CourseEvent, Slot } from '../../domain/types';
import type { CollisionKind } from './EventBlock';

export interface DayBlockInfo {
  event: CourseEvent;
  slot: Slot;
  subjectName: string;
  collisionKind?: CollisionKind;
  /**
   * Set on ghost blocks only: what switching to this group would do to the week's score.
   * Absent on a scheduled block — you are already in it — and on a ghost whose subject somehow
   * priced nothing.
   */
  switchCost?: SwitchCost;
  /** Set on a scheduled block the user pinned: the optimizer is not moving this one. */
  pinned?: boolean;
}
