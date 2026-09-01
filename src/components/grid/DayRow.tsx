import type { Day, HourRulerEntry } from '../../domain/types';
import EventBlock, { type CollisionKind } from './EventBlock';
import type { DayBlockInfo } from './gridTypes';

const BLOCK_HEIGHT = 76;
const BLOCK_GAP = 6;
/* Two pixels taller than it needs to be as decoration: a ghost is now a button you click to
   choose that group, and 8px is not a target anyone can hit. */
const GHOST_HEIGHT = 10;
const GHOST_GAP = 2;

interface DayRowProps {
  day: Day;
  minHour: number;
  maxHour: number;
  hours: HourRulerEntry[];
  blocks: DayBlockInfo[];
  ghostBlocks: DayBlockInfo[];
  /** Clicking a ghost chooses that group. Absent while there is no solution to switch from. */
  onPin?: (subjectCode: string, seminarId: string) => void;
}

function assignLanes(blocks: DayBlockInfo[]): Array<{ block: DayBlockInfo; lane: number }> {
  const sorted = [...blocks].sort((a, b) => a.slot.start - b.slot.start);
  const laneEnds: number[] = [];
  const placed: Array<{ block: DayBlockInfo; lane: number }> = [];
  for (const block of sorted) {
    let lane = laneEnds.findIndex((end) => end <= block.slot.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.slot.end);
    } else {
      laneEnds[lane] = block.slot.end;
    }
    placed.push({ block, lane });
  }
  return placed;
}

export default function DayRow({ day, minHour, maxHour, hours, blocks, ghostBlocks, onPin }: DayRowProps) {
  const placed = assignLanes(blocks);
  const laneCount = placed.length > 0 ? Math.max(...placed.map((p) => p.lane + 1)) : 1;
  const mainHeight = laneCount * BLOCK_HEIGHT + (laneCount - 1) * BLOCK_GAP;

  const ghostPlaced = assignLanes(ghostBlocks);
  const ghostLaneCount = ghostPlaced.length > 0 ? Math.max(...ghostPlaced.map((p) => p.lane + 1)) : 0;
  const ghostHeight = ghostLaneCount > 0 ? ghostLaneCount * GHOST_HEIGHT + (ghostLaneCount - 1) * GHOST_GAP + 6 : 0;
  const total = maxHour - minHour;

  return (
    <div className="day-row" style={{ height: mainHeight + ghostHeight + 16 }}>
      <div className="day-row__gutter">{day}</div>
      <div className="day-row__track">
        {hours.map((hour) => (
          <span
            key={hour.start}
            className="day-row__gridline"
            aria-hidden="true"
            style={{ left: `${((hour.start - minHour) / total) * 100}%` }}
          />
        ))}
        {placed.map(({ block, lane }) => (
          <EventBlock
            key={`${block.event.id}-${block.slot.start}`}
            event={block.event}
            subjectName={block.subjectName}
            slot={block.slot}
            minHour={minHour}
            maxHour={maxHour}
            top={lane * (BLOCK_HEIGHT + BLOCK_GAP) + 8}
            height={BLOCK_HEIGHT}
            collisionKind={block.collisionKind as CollisionKind | undefined}
            pinned={block.pinned}
            onUnpin={block.pinned && onPin ? () => onPin(block.event.subjectCode, block.event.id) : undefined}
          />
        ))}
        {ghostPlaced.map(({ block, lane }) => (
          <EventBlock
            key={`ghost-${block.event.id}-${block.slot.start}`}
            event={block.event}
            subjectName={block.subjectName}
            slot={block.slot}
            minHour={minHour}
            maxHour={maxHour}
            top={mainHeight + 12 + lane * (GHOST_HEIGHT + GHOST_GAP)}
            height={GHOST_HEIGHT}
            ghost
            switchCost={block.switchCost}
            onActivate={onPin ? () => onPin(block.event.subjectCode, block.event.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
