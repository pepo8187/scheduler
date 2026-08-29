import type { CourseEvent, Slot } from '../../domain/types';
import type { CollisionKind } from './EventBlock';

export interface DayBlockInfo {
  event: CourseEvent;
  slot: Slot;
  subjectName: string;
  collisionKind?: CollisionKind;
}
