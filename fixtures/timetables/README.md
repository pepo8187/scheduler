# Timetable fixtures

Real MUNI IS exports kept for **testing only**. Nothing here is served by the app.

The two exports the app offers as in-page examples live in `public/` instead, because Vite
copies that directory verbatim into the build — anything placed there ships to the web. Files
in this folder are read from disk by vitest and never reach a bundle.

Read one with `readFileSync(resolve(process.cwd(), 'fixtures/timetables/<name>'), 'utf8')`;
vitest always runs with the project root as cwd (see `src/domain/__tests__/sample.ts` for the
same pattern against `public/`).

## What's here

### `podzim24-timetable.xml` — autumn 2024

9 subjects, 50 slots, 37 notes, 3 `<nezname>` entries. Identical element vocabulary to the
bundled exports, so it exercises the parser without needing any new support.

Worth keeping for four shapes the bundled exports don't have:

**Slot lengths that differ by ten minutes.** The only real instance we have of one class
running to `:40` while another runs to `:50`, which happens when courses come from different
faculties:

| | |
|---|---|
| `CORE033` (university-wide course) | St 14:00–**15:40** — 100 min |
| `MA018`, `PB007/01` | St 14:00–**15:50** — 110 min |

This is the case that motivates canonicalising times before comparing week shapes
(`docs/plans/01-distinct-shapes.DONE.md`).

**…alongside same-start pairs that must *not* be treated as equal**, which is what makes it a
real test rather than an illustration:

| day/start | ends present | difference |
|---|---|---|
| St 14:00 | 15:40 / 15:50 | 10 min — same shape |
| Út 12:00 | 12:50 / 13:50 | 60 min — different |
| Út 16:00 | 16:50 / 17:50 | 60 min — different |
| Pá 08:00 | 09:50 / 14:40 | 290 min — different |

**Block-taught sessions.** The `p947` groups (a hiking PE course) are **400-minute slots
taught on three specific dates** — `pouze Pá 4. 10., Pá 18. 10. a Pá 25. 10.` — not weekly at
all. The app currently models each as a 6h40m *weekly* commitment, which badly overstates
them. A third cadence beyond weekly and fortnightly, and unmodelled; see the note at the end
of `docs/plans/01-distinct-shapes.DONE.md`.

**Compound parity notes.** Its two alternating-week notes append a make-up date to the
fortnightly pattern — `každou sudou středu 8:00–9:50, … a St 4. 12. 8:00–9:50`. `parseNoteParity`
reads the dominant pattern and ignores the extra date, which is the intended behaviour.

Also: 50-minute half-length seminars (`IB107/02`–`/05`), a lowercase subject code (`p947`),
and two lecture↔lecture overlaps in the full selection — the "fact of the export, badged not
an error" case.

## Adding another export

Drop the XML in, give it a `<period><year>-timetable.xml` name, and add a section above saying
what it is *notable for*. A corpus is only useful if each file earns its place — note the
shapes it has that the others don't, not just that it exists.

Check before committing: these are real exports, so confirm the file carries nothing beyond
course codes, rooms and teacher names (all public faculty information, and already present in
the bundled examples).
