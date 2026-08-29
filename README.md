# Schedule Optimizer

A web app that reads a MUNI IS timetable export and works out the best personal weekly
schedule for you.

Lectures are **givens** — the faculty fixes them and you either attend or you don't. The real
decision, and the whole point of this app, is **which seminar group to take for each subject**.
You narrow the candidates (keep only the groups taught by the teacher you want, drop subjects
you aren't taking), state your preferences, and the optimizer searches the remaining
combinations for the schedule that fits you best.

> **Status: scaffold.** The project skeleton, theme system and test harness are in place.
> The parser, solver and UI are being built per [`docs/PLAN.md`](docs/PLAN.md).

## What it will do

- **Read the IS export** — the same XML `<rozvrh>` format the school system produces. A sample
  is bundled at `public/sample-timetable.xml`.
- **Let you prune the options** — deselect a whole subject, an individual lecture, or specific
  seminar groups. Filter groups by teacher in one click.
- **Optimize for your preferences** — cram everything into as few days as possible or spread it
  out, keep a day free (typically Friday), avoid early mornings and late evenings, minimise
  dead time between classes.
- **Explain itself** — when a wish can't be granted it says exactly why. "Friday off is blocked
  by IA012 Složitost (lecture, fixed)" beats an empty result, and it offers you the fix.
- **Never fail.** Overlapping lectures are a fact of the export, not an error: they are simply
  shaded a step apart and flagged. You always get a timetable back.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run test     # unit tests (vitest + jsdom)
npm run build    # typecheck + production build
```

Node 22 or newer.

## Reading the input format

The export nests as `<rozvrh>` → `<tabulka>` → `<den>` (a weekday) → `<radek>` (a stacking row,
purely for layout) → `<slot>` (one class meeting). What matters:

| Element | Meaning |
| --- | --- |
| `<minhod>` / `<maxhod>` | Structural grid bounds in minutes — the timetable is drawn 08:00–20:00 |
| `<slot odcas docas>` | Start and end time of a meeting |
| `<akce><kod>` | The class code — see below |
| `<mistnosti>` / `<ucitele>` | Rooms and teachers, repeated once per teaching week (de-duplicated on parse) |
| `<poznamky>` | Notes and irregular-timing dates; shown on hover, ignored by the solver |
| `<nezname>` | Courses with no time (state exams, thesis defence); listed, never scheduled |

The code tells you what kind of class it is:

- `MA012` — a **lecture** of subject `MA012`
- `MA012/03` — **seminar group 03** of subject `MA012`

A subject may have both, only a lecture (`IA012`), or only seminars (`LJ601`, a language
class with six groups and no lecture).

## Colour

Colour encodes the *kind* of class, never the subject — subjects are told apart by their text.

- **Lectures** — bronze/terracotta. Subdued, because they are fixed.
- **Seminars** — sage/olive. The thing the optimizer actually chooses.
- **Overlapping lectures** — a burnt-sienna step within the lecture family, plus a ⚠.

Light theme by default (warm, earthy, Material You), with a dark mode toggle in the header.

## Layout

```
docs/PLAN.md                 full implementation plan
public/sample-timetable.xml  bundled example export
src/domain/                  parser, analysis, scoring, solver — pure TypeScript, no React
src/state/                   reducer + context, localStorage persistence
src/components/              sidebar, preferences, week grid, results
src/styles/theme.css         every colour, radius and shadow token
```

The domain layer imports no React, so the parser and solver are unit-testable headlessly.
