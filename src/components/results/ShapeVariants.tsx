import { describeVariantChanges, type VariantChange } from '../../domain/variants';
import type { Solution, Timetable } from '../../domain/types';

/** How many of a variant's moves fit on its chip before the rest go to the tooltip. */
const CHIPS_SHOWN = 2;

interface ShapeVariantsProps {
  timetable: Timetable;
  /** The rung this list belongs to — the labelling shown when nothing is selected. */
  base: Solution;
  variants: Solution[];
  /** Index into `variants`, or null for the rung's own labelling. */
  selected: number | null;
  onSelect: (index: number | null) => void;
}

function describeChange(change: VariantChange): string {
  return `${change.subjectCode} ${change.when}`;
}

/**
 * The other labellings of the week currently on screen.
 *
 * Deduping the strip by shape is what made it readable and is also what made this invisible:
 * a rung stands for every week with the same blocks, and two subjects trading slots is one of
 * those. Same grid, same score — provably, since the objective never reads subject identity —
 * but a different subject at 8am, which is not a detail people are indifferent to.
 *
 * Each chip describes only **what moved**. The week is identical by definition, so listing it
 * would be noise; the moves are the entire news. Picking one applies the whole assignment at
 * once — a jump to a sibling solution rather than an edit — so there is no state to write and
 * no half-applied swap to get stuck in.
 */
export default function ShapeVariants({ timetable, base, variants, selected, onSelect }: ShapeVariantsProps) {
  if (variants.length === 0) return null;

  return (
    <div className="shape-variants">
      <span className="shape-variants__label">Same week, also available as:</span>
      <button
        type="button"
        className={`shape-variants__item${selected === null ? ' shape-variants__item--active' : ''}`}
        onClick={() => onSelect(null)}
        title="The labelling this rung was ranked under"
      >
        as ranked
      </button>
      {variants.map((variant, index) => {
        const changes = describeVariantChanges(base, variant, timetable);
        const shown = changes.slice(0, CHIPS_SHOWN).map(describeChange).join(' · ');
        const rest = changes.length - CHIPS_SHOWN;
        return (
          <button
            key={index}
            type="button"
            className={`shape-variants__item${selected === index ? ' shape-variants__item--active' : ''}`}
            onClick={() => onSelect(index)}
            title={`Same blocks, same score — only who is in them changes:\n${changes.map(describeChange).join('\n')}`}
          >
            {shown}
            {rest > 0 && <span className="shape-variants__more">+{rest}</span>}
          </button>
        );
      })}
    </div>
  );
}
