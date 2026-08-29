import { useMemo } from 'react';
import { GAP_BADNESS_CAP, gapBadness } from '../../domain/score';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD = { top: 16, right: 20, bottom: 32, left: 8 };
const PLOT_WIDTH = CHART_WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = CHART_HEIGHT - PAD.top - PAD.bottom;
const MAX_MINUTES = 600; // 10 hours: comfortably past where the curve has flattened out
const HOUR_TICKS = [0, 2, 4, 6, 8, 10];

function buildCurve() {
  const points: { x: number; y: number; minutes: number; badness: number }[] = [];
  for (let minutes = 0; minutes <= MAX_MINUTES; minutes += 5) {
    const badness = gapBadness(minutes);
    points.push({ x: minutes, y: badness, minutes, badness });
  }
  return points;
}

/** Explains the dead-time scoring curve to end users, with the actual curve plotted live. */
export default function GapExplainer() {
  const { path, areaPath, capY } = useMemo(() => {
    const points = buildCurve();
    const yMax = GAP_BADNESS_CAP * 1.15;
    const toX = (minutes: number) => PAD.left + (minutes / MAX_MINUTES) * PLOT_WIDTH;
    const toY = (badness: number) => PAD.top + PLOT_HEIGHT - (badness / yMax) * PLOT_HEIGHT;

    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(' ');
    const areaPath = `${path} L ${toX(MAX_MINUTES).toFixed(1)} ${(PAD.top + PLOT_HEIGHT).toFixed(1)} L ${toX(0).toFixed(1)} ${(
      PAD.top + PLOT_HEIGHT
    ).toFixed(1)} Z`;

    return { path, areaPath, capY: toY(GAP_BADNESS_CAP) };
  }, []);

  return (
    <section className="panel gap-explainer">
      <h2 className="panel__title">Why dead time isn&rsquo;t scored linearly</h2>

      <p className="gap-explainer__copy">
        A gap between two classes isn&rsquo;t bad in proportion to its length &mdash; but a longer gap is also{' '}
        <strong>never scored better</strong> than a shorter one, let alone better than no gap at all. A short
        walk-between-buildings gap is basically free. By a couple of hours it really hurts. Past that, each extra
        idle minute matters less &mdash; another hour on top of an already-dead afternoon barely registers &mdash;
        but the cost never goes down, it only levels off. So a single long block is treated as no worse than the
        worst point along the way, never as an improvement over it.
      </p>

      <div className="gap-explainer__chart-wrap">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="gap-explainer__chart" role="img" aria-label="Dead-time penalty by gap length, rising through the first couple of hours and flattening out for longer gaps">
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
            cap: never scored worse than this
          </text>
        </svg>
      </div>

      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Modelled as the Gamma(shape&nbsp;2) CDF: it rises from zero and asymptotically approaches a cap of{' '}
        {GAP_BADNESS_CAP} &mdash; i.e. the longest possible gap costs about what a naive per-minute penalty would
        have charged for a two-hour hole, and every other length is scored relative to that, but always
        non-decreasing in length:
      </p>
      <pre className="gap-explainer__formula">
        <code>
          badness(m) = {GAP_BADNESS_CAP} · (1 &minus; e^(&minus;m/60) · (1 + m/60))
        </code>
      </pre>
      <p className="gap-explainer__copy gap-explainer__copy--muted">
        There&rsquo;s no separate exemption for lunchtime or any other time of day — only a gap&rsquo;s length
        matters, so a midday class is never penalised just for sitting where a fixed lunch window might otherwise
        have been.
      </p>
    </section>
  );
}
