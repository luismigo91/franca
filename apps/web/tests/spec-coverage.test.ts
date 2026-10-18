import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text';

/**
 * Cada `#### Scenario` de `web-chat` y de `web-editor` (el delta mientras el cambio esté activo; la spec vigente después de archivarlo) tiene
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

const CAPABILITIES = [
  { name: 'web-chat', minRequirements: 41, minScenarios: 63 },
  { name: 'web-editor', minRequirements: 44, minScenarios: 78 },
] as const;

const specs = CAPABILITIES.map((capability) => {
  const { requirements } = effectiveSpec(capability.name);
  return { ...capability, requirements, scenarios: [...requirements].flatMap(([requirement, titles]) => titles.map((title) => [requirement, title] as const)) };
});

describe('los títulos de escenario no se repiten entre capacidades', () => {
  it('no hay títulos de escenario repetidos entre web-chat y web-editor (el buscador es global)', () => {
    const titles = specs.flatMap((spec) => spec.scenarios.map(([, title]) => title));
    expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
  });
});

for (const spec of specs) {
  describe(`escenarios de la spec de ${spec.name}`, () => {
    it('la spec tiene escenarios', () => {
      expect(spec.requirements.size).toBeGreaterThanOrEqual(spec.minRequirements);
      expect(spec.scenarios.length).toBeGreaterThanOrEqual(spec.minScenarios);
    });

    it('no hay títulos de escenario repetidos', () => {
      const titles = spec.scenarios.map(([, title]) => title);
      expect(titles.filter((title, index) => titles.indexOf(title) !== index)).toEqual([]);
    });

    it.each(spec.scenarios)('«%s» → «%s» tiene su test', (_requirement, title) => {
      const titled = [`it('${title}'`, `it("${title}"`, `test('${title}'`, `test("${title}"`].some((needle) => code.includes(needle));
      expect(titled, `falta un it/test('${title}')`).toBe(true);
    });
  });
}
