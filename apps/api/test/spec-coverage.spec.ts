import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text.js';

/**
 * Cada `#### Scenario` de las dos capacidades de `api-flows` (el delta mientras el cambio esté activo; la spec vigente
 * después de archivarlo) tiene un `it` con exactamente su título: `flows-api` en `apps/api`, y `flow-validation` en
 * `packages/spec/tests/` o en el test de paridad del motor. Y ningún título de escenario se repite en una capacidad.
 */
function sources(dir: URL, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'generated' ? [] : sources(url, suffix);
    return entry.name.endsWith(suffix) && entry.name !== 'spec-coverage.spec.ts' ? [readFileSync(url, 'utf8')] : [];
  });
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const apiCode = [
  ...sources(new URL('./', import.meta.url), '.e2e-spec.ts'),
  ...sources(new URL('../src/', import.meta.url), '.spec.ts'),
].join('\n');

const validationCode = [...sources(new URL('../../../packages/spec/tests/', import.meta.url), '.test.ts'), read('../../../packages/engine/tests/flow-depth-parity.test.ts')].join('\n');

const capabilities = [
  { name: 'flows-api', code: apiCode, minimum: { requirements: 30, scenarios: 95 } },
  { name: 'flow-validation', code: validationCode, minimum: { requirements: 8, scenarios: 34 } },
] as const;

for (const { name, code, minimum } of capabilities) {
  describe(`escenarios de la spec de ${name}`, () => {
    const { requirements } = effectiveSpec(name);
    const scenarios = [...requirements].flatMap(([requirement, titles]) => titles.map((title) => [requirement, title] as const));

    it('la spec tiene escenarios', () => {
      expect(requirements.size).toBeGreaterThanOrEqual(minimum.requirements);
      expect(scenarios.length).toBeGreaterThanOrEqual(minimum.scenarios);
    });

    it('no hay títulos de escenario repetidos', () => {
      const titles = scenarios.map(([, title]) => title);
      const repeated = titles.filter((title, index) => titles.indexOf(title) !== index);
      expect(repeated).toEqual([]);
    });

    it.each(scenarios)('«%s» → «%s» tiene su it', (_requirement, title) => {
      const titled = code.includes(`it('${title}'`) || code.includes(`it("${title}"`) || code.includes(`it(\`${title}\``);
      expect(titled, `falta un it('${title}')`).toBe(true);
    });
  });
}
