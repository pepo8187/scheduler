import { describe, expect, it } from 'vitest';
import { parseSampleXml } from './sample';

/**
 * Scaffold smoke test.
 *
 * It pins the two things the rest of the work depends on: the bundled sample
 * export is present and well-formed, and the jsdom environment really does give
 * us the same native DOMParser the browser uses (which is why the parser needs
 * no XML dependency). The real parser tests live in `parseTimetable.test.ts`.
 */

const loadSample = parseSampleXml;

describe('sample timetable fixture', () => {
  it('parses with the native DOMParser and has no parser errors', () => {
    const doc = loadSample();
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName).toBe('rozvrh');
  });

  it('exposes the structural grid bounds of 08:00-20:00', () => {
    const doc = loadSample();
    expect(doc.querySelector('minhod')?.textContent).toBe('480');
    expect(doc.querySelector('maxhod')?.textContent).toBe('1200');
  });

  it('contains the 64 scheduled slots across five days', () => {
    const doc = loadSample();
    expect(doc.querySelectorAll('tabulka slot')).toHaveLength(64);
    const days = [...doc.querySelectorAll('tabulka den')].map((d) => d.getAttribute('id'));
    expect(days).toEqual(['Po', 'Út', 'St', 'Čt', 'Pá']);
  });

  it('carries both lecture codes and slash-suffixed seminar group codes', () => {
    const doc = loadSample();
    const codes = [...doc.querySelectorAll('tabulka slot akce kod')].map((k) => k.textContent);
    expect(codes).toContain('IB111');
    expect(codes).toContain('IB111/01');
    // PV275 is a forced choice: exactly one seminar group alongside its lecture.
    expect(codes.filter((c) => c?.startsWith('PV275/'))).toHaveLength(1);
  });

  it('lists the unscheduled (nezname) courses that must never be placed on the grid', () => {
    const doc = loadSample();
    const codes = [...doc.querySelectorAll('nezname akce kod')].map((k) => k.textContent);
    expect(codes).toHaveLength(16);
    expect(codes.every((c) => c?.startsWith('IB111/') && c?.endsWith('_nahrada'))).toBe(true);
  });
});
