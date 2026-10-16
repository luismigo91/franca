import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectiveSpec } from './helpers/spec-text.js';

/**
 * Cada `#### Scenario` de la spec de `llm-anthropic` (el delta mientras el cambio esté activo; la spec
 * vigente después de archivarlo) tiene un `it` con exactamente su título.
 */
const { requirements } = effectiveSpec('llm-anthropic');

function testFiles(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) return entry.name === 'live' || entry.name === 'fixtures' ? [] : testFiles(url);
    return entry.name.endsWith('.test.ts') && entry.name !== 'spec-coverage.test.ts' ? [readFileSync(url, 'utf8')] : [];
  });
}

const code = testFiles(new URL('./', import.meta.url)).join('\n');
const scenarios = [...requirements].flatMap(([requirement, titles]) => titles.map((title) => [requirement, title] as const));

describe('escenarios de la spec de llm-anthropic', () => {
  it('la spec tiene escenarios', () => {
    expect(requirements.size).toBeGreaterThanOrEqual(25);
    expect(scenarios.length).toBeGreaterThanOrEqual(55);
  });

  it.each(scenarios)('«%s» → «%s» tiene su it', (_requirement, title) => {
    const titled = code.includes(`it('${title}'`) || code.includes(`it("${title}"`);
    expect(titled, `falta un it('${title}')`).toBe(true);
  });
});
