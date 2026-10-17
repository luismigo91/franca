import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text.js';

/**
 * Cada `#### Scenario` de las capacidades `flows-api`, `conversations-api`, `http-host` y `dev-simulated-services` (el delta mientras el cambio esté activo; la
 * spec vigente después de archivarlo) tiene un `it` con exactamente su título en `apps/api`, y el de `flow-validation`
 * en `packages/spec/tests/` o en el test de paridad del motor. Y ningún título de escenario se repite en una capacidad.
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
  // Los unit de la demo local (`apps/api/demo/`).
  ...sources(new URL('./demo/', import.meta.url), '.spec.ts'),
].join('\n');

const validationCode = [...sources(new URL('../../../packages/spec/tests/', import.meta.url), '.test.ts'), read('../../../packages/engine/tests/flow-depth-parity.test.ts')].join('\n');

/**
 * Escenarios que solo se pueden comprobar a mano (con un navegador o con la red de la máquina) y por eso no tienen `it`:
 * título → motivo. Cada exclusión se verifica en la fase 6 de `tasks.md` del cambio y debe tener un motivo escrito.
 */
const MANUAL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'dev-simulated-services': {
    'Lead de punta a punta en la demo': 'necesita un navegador sobre la web real; la parte de API la cubre «Leads consecutivos»',
    'Demo sin Internet': 'necesita observar las conexiones de los procesos de la máquina; la parte sin resolución la cubren los e2e de nombres locales',
  },
};

const capabilities = [
  { name: 'flows-api', code: apiCode, minimum: { requirements: 30, scenarios: 95 } },
  { name: 'conversations-api', code: apiCode, minimum: { requirements: 49, scenarios: 71 } },
  { name: 'http-host', code: apiCode, minimum: { requirements: 21, scenarios: 33 } },
  { name: 'dev-simulated-services', code: apiCode, minimum: { requirements: 14, scenarios: 28 } },
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

    it('cada exclusión manual nombra un escenario que existe y tiene un motivo', () => {
      const manual = MANUAL[name] ?? {};
      const titles = scenarios.map(([, title]) => title);
      for (const [title, reason] of Object.entries(manual)) {
        expect(titles, `la exclusión «${title}» no es un escenario de ${name}`).toContain(title);
        expect(reason.length, `falta el motivo de «${title}»`).toBeGreaterThan(20);
      }
    });

    it.each(scenarios.filter(([, title]) => !(title in (MANUAL[name] ?? {}))))('«%s» → «%s» tiene su it', (_requirement, title) => {
      const titled = code.includes(`it('${title}'`) || code.includes(`it("${title}"`) || code.includes(`it(\`${title}\``);
      expect(titled, `falta un it('${title}')`).toBe(true);
    });
  });
}
