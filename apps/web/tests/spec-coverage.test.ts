import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text';

/**
 * Cada `#### Scenario` de `web-chat` (el delta mientras el cambio esté activo; la spec vigente después de archivarlo) tiene
 * un `it`/`test` con exactamente su título en `src/**\/*.test.{ts,tsx}`, `tests/**\/*.test.ts` o `e2e/**\/*.e2e.ts`, y
 * ningún título se repite. Es el patrón de `apps/api/test/spec-coverage.spec.ts`, sin tocar la API (D22).
 */
function sources(dir: URL, matches: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === '.next' ? [] : sources(url, matches);
    return matches(entry.name) && entry.name !== 'spec-coverage.test.ts' ? [readFileSync(url, 'utf8')] : [];
  });
}

const code = [
  ...sources(new URL('../src/', import.meta.url), (name) => /\.test\.(ts|tsx)$/.test(name)),
  ...sources(new URL('./', import.meta.url), (name) => /\.test\.ts$/.test(name)),
  ...sources(new URL('../e2e/', import.meta.url), (name) => name.endsWith('.e2e.ts')),
].join('\n');

const { requirements } = effectiveSpec('web-chat');
const scenarios = [...requirements].flatMap(([requirement, titles]) => titles.map((title) => [requirement, title] as const));

describe('escenarios de la spec de web-chat', () => {
  it('la spec tiene escenarios', () => {
    expect(requirements.size).toBeGreaterThanOrEqual(41);
    expect(scenarios.length).toBeGreaterThanOrEqual(63);
  });

  it('no hay títulos de escenario repetidos', () => {
    const titles = scenarios.map(([, title]) => title);
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
  });

  it.each(scenarios)('«%s» → «%s» tiene su test', (_requirement, title) => {
    const titled = [`it('${title}'`, `it("${title}"`, `test('${title}'`, `test("${title}"`].some((needle) => code.includes(needle));
    expect(titled, `falta un it/test('${title}')`).toBe(true);
  });
});
