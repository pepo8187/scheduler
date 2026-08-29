import { useMemo } from 'react';
import { GAP_PEAK_MINUTES, gapBadness } from '../../domain/score';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD = { top: 16, right: 20, bottom: 32, left: 8 };
const PLOT_WIDTH = CHART_WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = CHART_HEIGHT - PAD.top - PAD.bottom;
const MAX_MINUTES = 600; // 10 hours: comfortably past where the curve has flattened out
const HOUR_TICKS = [0, 2, 4, 6, 8, 10];

function buildCurve() {
  const points: { x: number; y: number; minutes: number; badness: number }[] = [];
  let peakBadness = 0;
  for (let minutes = 0; minutes <= MAX_MINUTES; minutes += 5) {
    const badness = gapBadness(minutes);
    peakBadness = Math.max(peakBadness, badness);
    points.push({ x: minutes, y: badness, minutes, badness });
  }
  return { points, peakBadness };
}

/** Explains the dead-time scoring curve to end users, with the actual curve plotted live. */
export default function GapExplainer() {
  const { path, areaPath, peakX, peakY } = useMemo(() => {
    const { points, peakBadness } = buildCurve();
    const yMax = peakBadness * 1.15;
    const toX = (minutes: number) => PAD.left + (minutes / MAX_MINUTES) * PLOT_WIDTH;
    const toY = (badness: number) => PAD.top + PLOT_HEIGHT - (badness / yMax) * PLOT_HEIGHT;

    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(1)} ${toY(p.y).toFixed(1)}`).join(' ');
    const areaPath = `${path} L ${toX(MAX_MINUTES).toFixed(1)} ${(PAD.top + PLOT_HEIGHT).toFixed(1)} L ${toX(0).toFixed(1)} ${(
      PAD.top + PLOT_HEIGHT
    ).toFixed(1)} Z`;

    return { path, areaPath, peakX: toX(GAP_PEAK_MINUTES), peakY: toY(gapBadness(GAP_PEAK_MINUTES)) };
  }, []);

  return (
    <section className="panel gap-explainer">
      <h2 className="panel__title">Why dead time isn&rsquo;t scored linearly</h2>

      <p className="gap-explainer__copy">
        A gap between two classes isn&rsquo;t bad in proportion to its length. A short walk-between-buildings gap is
        basically free. A <strong>~2 hour gap is the worst case</strong> — too long to just wait it out, too short to
        leave campus and do anything useful with. Past that peak, longer gaps get sharply <em>less</em> bad: 4 hours
        is enough for a real library session, 6&ndash;8 hours is enough to go home or to work and come back. So one
        long block on an otherwise light day is treated as only mildly worse than no gap at all — never as badly as
        the 2-hour hole sitting inside it would be on its own.
      </p>

      <div className="gap-explainer__chart-wrap">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="gap-explainer__chart" role="img" aria-label="Dead-time penalty by gap length, peaking around 2 hours and falling off for longer gaps">
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

          <line x1={peakX} y1={peakY} x2={peakX} y2={PAD.top + PLOT_HEIGHT} className="gap-explainer__peak-guide" />
          <circle cx={peakX} cy={peakY} r={4} className="gap-explainer__peak-dot" />
          <text x={peakX} y={peakY - 10} className="gap-explainer__peak-label" textAnchor="middle">
            ~2h: worst case
          </text>
        </svg>
      </div>

      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Modelled as a Gamma(shape&nbsp;2) curve: it rises from zero, peaks at a {GAP_PEAK_MINUTES / 60}-hour gap, then
        decays exponentially. Rescaled so the peak itself equals {GAP_PEAK_MINUTES} — i.e. the worst-case gap costs
        exactly what a naive per-minute penalty would have charged for that length, and every other length is
        discounted relative to it:
      </p>
      <pre className="gap-explainer__formula">
        <code>
          badness(m) = {GAP_PEAK_MINUTES / 4} · (m / {GAP_PEAK_MINUTES / 2})² · e^(2 − m / {GAP_PEAK_MINUTES / 2})
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
