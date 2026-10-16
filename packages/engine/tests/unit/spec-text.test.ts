import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { effectiveSpec, parseRequirements } from '../helpers/spec-text.js';

const MAIN = `## Requirements

### Requirement: Uno
texto

#### Scenario: A
- **WHEN** x

### Requirement: Dos
texto

#### Scenario: B
#### Scenario: C
`;

const DELTA = `## ADDED Requirements

### Requirement: Tres
texto

#### Scenario: D

## MODIFIED Requirements

### Requirement: Dos
nuevo

#### Scenario: B
#### Scenario: E
`;

/** Un árbol openspec/ temporal con la spec vigente, un cambio activo y uno archivado. */
function tree(): URL {
  const root = mkdtempSync(join(tmpdir(), 'franca-spec-text-'));
  mkdirSync(join(root, 'specs/cap'), { recursive: true });
  writeFileSync(join(root, 'specs/cap/spec.md'), MAIN);
  mkdirSync(join(root, 'changes/activo/specs/cap'), { recursive: true });
  writeFileSync(join(root, 'changes/activo/specs/cap/spec.md'), DELTA);
  mkdirSync(join(root, 'changes/archive/2026-01-01-viejo/specs/cap'), { recursive: true });
  writeFileSync(join(root, 'changes/archive/2026-01-01-viejo/specs/cap/spec.md'), '### Requirement: Archivado\n\n#### Scenario: Z\n');
  return pathToFileURL(`${root}/`);
}

describe('parseRequirements', () => {
  it('lee requisitos y escenarios en orden', () => {
    expect([...parseRequirements(MAIN)]).toEqual([['Uno', ['A']], ['Dos', ['B', 'C']]]);
  });
});

describe('effectiveSpec', () => {
  it('ADDED añade, MODIFIED sustituye por título y lo archivado no cuenta', () => {
    const { requirements } = effectiveSpec('cap', tree());
    expect([...requirements]).toEqual([['Uno', ['A']], ['Dos', ['B', 'E']], ['Tres', ['D']]]);
  });

  it('sin cambios activos devuelve la vigente', () => {
    const root = mkdtempSync(join(tmpdir(), 'franca-spec-text-'));
    mkdirSync(join(root, 'specs/cap'), { recursive: true });
    writeFileSync(join(root, 'specs/cap/spec.md'), MAIN);
    expect([...effectiveSpec('cap', pathToFileURL(`${root}/`)).requirements]).toEqual([...parseRequirements(MAIN)]);
  });

  it('una capacidad sin spec vigente (solo delta) también se lee', () => {
    const root = mkdtempSync(join(tmpdir(), 'franca-spec-text-'));
    mkdirSync(join(root, 'changes/nuevo/specs/cap'), { recursive: true });
    writeFileSync(join(root, 'changes/nuevo/specs/cap/spec.md'), DELTA);
    expect([...effectiveSpec('cap', pathToFileURL(`${root}/`)).requirements].map(([title]) => title)).toEqual(['Tres', 'Dos']);
  });
});
