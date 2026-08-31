import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shared access to the bundled MUNI IS export used as the test fixture.
 *
 * Resolved from the project root rather than `import.meta.url`: the tests run in
 * the jsdom environment, where `import.meta.url` is an http: URL and cannot be
 * turned back into a filesystem path. Vitest always runs with the project root
 * as cwd.
 */
export const SAMPLE_PATH = resolve(process.cwd(), 'public/podzim23-timetable.xml');

export function readSampleXml(): string {
  return readFileSync(SAMPLE_PATH, 'utf8');
}

export function parseSampleXml(): Document {
  return new DOMParser().parseFromString(readSampleXml(), 'application/xml');
}
