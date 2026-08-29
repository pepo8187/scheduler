import ThemeToggle from './components/ThemeToggle';

/**
 * Scaffold shell. The sidebar, preference panel and week grid land here in
 * steps 5-7 of docs/PLAN.md; this placeholder exists so the theme, layout
 * skeleton and build pipeline are verifiable from the very first commit.
 */
export default function App() {
  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <h1 className="app__title">Schedule Optimizer</h1>
          <p className="app__subtitle">Pick the seminar groups that fit your week</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="app__body">
        <aside className="app__sidebar panel">
          <h2 className="panel__title">Subjects</h2>
          <p className="placeholder">
            Load a timetable export to list subjects, their lectures and every seminar group.
          </p>
        </aside>

        <main className="app__main">
          <section className="panel">
            <h2 className="panel__title">Preferences</h2>
            <p className="placeholder">
              Days off, cram vs. spread, gaps, day window and teacher filters.
            </p>
          </section>

          <section className="panel panel--grow">
            <h2 className="panel__title">Week</h2>
            <div className="legend">
              <span className="legend__item">
                <span className="legend__swatch legend__swatch--lecture" aria-hidden="true" />
                Lecture &mdash; fixed
              </span>
              <span className="legend__item">
                <span className="legend__swatch legend__swatch--seminar" aria-hidden="true" />
                Seminar &mdash; chosen for you
              </span>
              <span className="legend__item">
                <span className="legend__swatch legend__swatch--clash" aria-hidden="true" />
                Overlapping lectures
              </span>
            </div>
            <p className="placeholder">The week grid renders here.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
