import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.js';
import * as conformance from '../src/conformance/index.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, { types: string; default: string }>; files: string[] };
const tsdownConfig = readFileSync(new URL('../tsdown.config.ts', import.meta.url), 'utf8');

describe('@franca/engine/conformance como subruta del paquete', () => {
  it('package.json la exporta con tipos y código, y tsdown tiene su entrada con ese nombre', () => {
    expect(packageJson.exports['./conformance']).toEqual({ types: './dist/conformance.d.mts', default: './dist/conformance.mjs' });
    expect(tsdownConfig).toContain("conformance: 'src/conformance/index.ts'");
    expect(packageJson.exports['.']).toEqual({ types: './dist/index.d.mts', default: './dist/index.mjs' });
    expect(packageJson.files).toEqual(['dist']);
  });

  it('exporta exactamente el catálogo, las direcciones internas y el margen de la espera límite', () => {
    expect(Object.keys(conformance).sort()).toEqual(['CALL_DEADLINE_MARGIN_MS', 'CONFORMANCE_INTERNAL_ADDRESSES', 'HOST_CONFORMANCE_CASES']);
    expect(conformance.HOST_CONFORMANCE_CASES).toHaveLength(21);
    expect(Object.isFrozen(conformance.HOST_CONFORMANCE_CASES) || Array.isArray(conformance.HOST_CONFORMANCE_CASES)).toBe(true);
  });

  it('el punto de entrada principal no arrastra el arnés de conformidad', () => {
    for (const name of Object.keys(conformance)) expect(Object.keys(engine)).not.toContain(name);
    expect(Object.keys(engine)).not.toContain('call');
  });

  it('cada caso tiene id, requisito, escenario y run, y los campos son strings no vacíos', () => {
    for (const c of conformance.HOST_CONFORMANCE_CASES) {
      expect(typeof c.run).toBe('function');
      for (const field of [c.id, c.requirement, c.scenario]) expect(field.trim()).not.toBe('');
      expect(c.requirement.startsWith('Host de producción: ')).toBe(true);
    }
  });
});
