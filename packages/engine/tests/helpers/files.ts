import { readdirSync, readFileSync } from 'node:fs';

const FIXTURES = new URL('../fixtures/', import.meta.url);
const EXAMPLES = new URL('../../../spec/examples/', import.meta.url);

const jsonFiles = (dir: URL): string[] => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

/** Nombres (sin extensión) de los fixtures de `tests/fixtures/`. */
export const fixtureNames = (): string[] => jsonFiles(FIXTURES).map((f) => f.replace(/\.json$/, ''));

/** Nombres (sin extensión) de los ejemplos de `packages/spec/examples/`, leídos por ruta relativa. */
export const exampleNames = (): string[] => jsonFiles(EXAMPLES).map((f) => f.replace(/\.json$/, ''));

const read = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));

export const readFixture = (name: string): unknown => read(new URL(`${name}.json`, FIXTURES));
export const readExample = (name: string): unknown => read(new URL(`${name}.json`, EXAMPLES));

/** Todos los flujos de ejemplo y fixtures, etiquetados. */
export const allFlows = (): { label: string; flow: unknown }[] => [
  ...fixtureNames().map((name) => ({ label: `fixtures/${name}`, flow: readFixture(name) })),
  ...exampleNames().map((name) => ({ label: `examples/${name}`, flow: readExample(name) })),
];
