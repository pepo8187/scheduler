import { useMemo } from 'react';
import { GAP_BADNESS_CAP, gapBadness, gapExponent, WEIGHTS } from '../../domain/score';
import { useScheduler } from '../../state/schedulerStore';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD = { top: 16, right: 20, bottom: 32, left: 8 };
const PLOT_WIDTH = CHART_WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = CHART_HEIGHT - PAD.top - PAD.bottom;
const MAX_MINUTES = 600; // 10 hours: comfortably past where the curve has flattened out
const HOUR_TICKS = [0, 2, 4, 6, 8, 10];

/** The Y axis is fixed to the cost of a maxed-out gap at slider 1, so the curve visibly shrinks as `gaps` drops. */
const MAX_COST = GAP_BADNESS_CAP * WEIGHTS.gapsPerIdleMinute;

/**
 * Convexity is near-impossible to read off a curve by eye, so the chart alone can't show what
 * the shape slider actually does. These are recomputed live underneath it: same idle time,
 * split two ways, with the arrangement the current settings prefer called out.
 */
const COMPARISONS: { label: string; a: { label: string; gaps: number[] }; b: { label: string; gaps: number[] } }[] = [
  {
    label: '6 hours of dead time',
    a: { label: 'one 6h break', gaps: [360] },
    b: { label: 'three 2h breaks', gaps: [120, 120, 120] },
  },
  {
    label: '3 hours of dead time',
    a: { label: 'one 3h break', gaps: [180] },
    b: { label: 'three 1h breaks', gaps: [60, 60, 60] },
  },
  {
    label: '1 hour of dead time',
    a: { label: 'one 1h break', gaps: [60] },
    b: { label: 'two 30m breaks', gaps: [30, 30] },
  },
];

/** Explains the dead-time scoring curve to end users, plotting the curve the sliders actually produce. */
export default function GapExplainer() {
  const { prefs } = useScheduler();
  const { gaps, gapShape } = prefs;

  const cost = useMemo(
    () => (minutes: number) => gapBadness(minutes, gapShape) * gaps * WEIGHTS.gapsPerIdleMinute,
    [gaps, gapShape],
  );

  const { path, areaPath, capY } = useMemo(() => {
    const yMax = MAX_COST * 1.15;
    const toX = (minutes: number) => PAD.left + (minutes / MAX_MINUTES) * PLOT_WIDTH;
    const toY = (value: number) => PAD.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;

    const points: { x: number; y: number }[] = [];
    for (let minutes = 0; minutes <= MAX_MINUTES; minutes += 5) {
      points.push({ x: toX(minutes), y: toY(cost(minutes)) });
    }

    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const floor = (PAD.top + PLOT_HEIGHT).toFixed(1);
    const areaPath = `${path} L ${toX(MAX_MINUTES).toFixed(1)} ${floor} L ${toX(0).toFixed(1)} ${floor} Z`;

    return { path, areaPath, capY: toY(GAP_BADNESS_CAP * gaps * WEIGHTS.gapsPerIdleMinute) };
  }, [cost, gaps]);

  const rows = useMemo(
    () =>
      COMPARISONS.map((row) => {
        const aCost = row.a.gaps.reduce((sum, m) => sum + cost(m), 0);
        const bCost = row.b.gaps.reduce((sum, m) => sum + cost(m), 0);
        return { ...row, aCost, bCost, winner: aCost === bCost ? null : aCost < bCost ? 'a' : 'b' };
      }),
    [cost],
  );

  return (
    <section className="panel gap-explainer">
      <h2 className="panel__title">How your sliders score dead time</h2>

      <p className="gap-explainer__copy">
        A gap between two classes isn&rsquo;t bad in proportion to its length &mdash; but a longer gap is also{' '}
        <strong>never scored better</strong> than a shorter one, let alone better than no gap at all. This is the
        curve your two sliders produce right now: <strong>Gaps</strong> sets how tall it gets (how much dead time
        costs against everything else), and <strong>Break shape</strong> bends it &mdash; flat near the origin
        means short breathers are nearly free, steep from the origin means every idle minute counts straight away.
      </p>

      <div className="gap-explainer__chart-wrap">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="gap-explainer__chart"
          role="img"
          aria-label={`Dead-time penalty by gap length at the current settings: gaps ${Math.round(
            gaps * 100,
          )} percent, break shape ${gapShape.toFixed(2)}`}
        >
          {HOUR_TICKS.map((h) => {
            const x = PAD.left + ((h * 60) / MAX_MINUTES) * PLOT_WIDTH;
            return (
              <g key={h}>
                <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + PLOT_HEIGHT} className="gap-explainer__gridline" />
                <text x={x} y={PAD.top + PLOT_HEIGHT + 18} className="gap-explainer__tick" textAnchor="middle">
                  {h}h
                </text>
              </g>
            );
          })}
          <line
            x1={PAD.left}
            y1={PAD.top + PLOT_HEIGHT}
            x2={PAD.left + PLOT_WIDTH}
            y2={PAD.top + PLOT_HEIGHT}
            className="gap-explainer__axis"
          />

          <path d={areaPath} className="gap-explainer__area" />
          <path d={path} className="gap-explainer__curve" />

          <line x1={PAD.left} y1={capY} x2={PAD.left + PLOT_WIDTH} y2={capY} className="gap-explainer__peak-guide" />
          <text x={PAD.left + PLOT_WIDTH} y={capY - 6} className="gap-explainer__peak-label" textAnchor="end">
            cap: {Math.round(GAP_BADNESS_CAP * gaps * WEIGHTS.gapsPerIdleMinute)} points
          </text>
        </svg>
      </div>

      <h3 className="gap-explainer__subtitle">What that means for your schedule</h3>
      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Same amount of idle time either way &mdash; these are the arrangements your current settings prefer.
      </p>

      <ul className="gap-compare">
        {rows.map((row) => (
          <li key={row.label} className="gap-compare__row">
            <span className="gap-compare__label">{row.label}</span>
            <span className={`gap-compare__option${row.winner === 'a' ? ' gap-compare__option--winner' : ''}`}>
              {row.a.label}
              <span className="gap-compare__cost">{Math.round(row.aCost)}</span>
            </span>
            <span className="gap-compare__vs">vs</span>
            <span className={`gap-compare__option${row.winner === 'b' ? ' gap-compare__option--winner' : ''}`}>
              {row.b.label}
              <span className="gap-compare__cost">{Math.round(row.bCost)}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Modelled as a Weibull CDF rising from zero to a cap of {GAP_BADNESS_CAP} badness &mdash; so the longest
        possible gap costs about what a naive per-minute penalty would have charged for a two-hour hole, and every
        other length is scored relative to that, always non-decreasing in length:
      </p>
      <pre className="gap-explainer__formula">
        <code>
          badness(m) = {GAP_BADNESS_CAP} · (1 &minus; e^(&minus;(m/120)^{gapExponent(gapShape).toFixed(2)}))
          {'\n'}
          cost(m) &nbsp;&nbsp;= badness(m) × {gaps.toFixed(2)} × {WEIGHTS.gapsPerIdleMinute}
        </code>
      </pre>
      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Because a single gap can never cost more than the cap, consolidating a genuinely long stretch wins wherever
        Break shape sits &mdash; two two-hour holes strand you on campus twice, which beats nobody&rsquo;s idea of a
        good day. The slider decides the cases below that ceiling, which is where real schedules live. There&rsquo;s
        also no exemption for lunchtime or any other time of day: only a gap&rsquo;s length matters, so a midday
        class is never penalised just for sitting where a fixed lunch window might otherwise have been.
      </p>
    </section>
  );
}
