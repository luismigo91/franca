import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { effectiveSpec, parseBlocks, parseRequirements } from '../helpers/spec-text.js';

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

const RENAMING_DELTA = `## RENAMED Requirements

- FROM: \`### Requirement: Uno\`
- TO: \`### Requirement: Uno nuevo\`

## MODIFIED Requirements

### Requirement: Uno nuevo
cuerpo renombrado

#### Scenario: A
#### Scenario: A2
`;

const RENAME_ONLY_DELTA = `## RENAMED Requirements

- FROM: \`### Requirement: Dos\`
- TO: \`### Requirement: Dos nuevo\`
`;

/** Un árbol openspec/ con la vigente `MAIN` y un único cambio activo con `delta`. */
function treeWith(delta: string): URL {
  const root = mkdtempSync(join(tmpdir(), 'franca-spec-text-'));
  mkdirSync(join(root, 'specs/cap'), { recursive: true });
  writeFileSync(join(root, 'specs/cap/spec.md'), MAIN);
  mkdirSync(join(root, 'changes/activo/specs/cap'), { recursive: true });
  writeFileSync(join(root, 'changes/activo/specs/cap/spec.md'), delta);
  return pathToFileURL(`${root}/`);
}

describe('effectiveSpec: RENAMED y bloques', () => {
  it('un renombrado conserva la posición del requisito', () => {
    const { requirements } = effectiveSpec('cap', treeWith(RENAME_ONLY_DELTA));
    expect([...requirements]).toEqual([['Uno', ['A']], ['Dos nuevo', ['B', 'C']]]);
  });

  it('renombrado y modificado en el mismo delta: gana el contenido del MODIFIED bajo el nombre nuevo, en la posición vieja', () => {
    const { requirements, blocks } = effectiveSpec('cap', treeWith(RENAMING_DELTA));
    expect([...requirements]).toEqual([['Uno nuevo', ['A', 'A2']], ['Dos', ['B', 'C']]]);
    expect(blocks.get('Uno nuevo')).toContain('cuerpo renombrado');
    expect(blocks.has('Uno')).toBe(false);
  });

  it('la sección RENAMED no crea requisitos', () => {
    const { requirements } = effectiveSpec('cap', treeWith(RENAME_ONLY_DELTA));
    expect([...requirements.keys()]).not.toContain('Dos');
    expect(parseRequirements(RENAME_ONLY_DELTA).size).toBe(0);
  });

  it('un renombrado sin modificar deja el texto del requisito con el título nuevo', () => {
    const { blocks } = effectiveSpec('cap', treeWith(RENAME_ONLY_DELTA));
    expect(blocks.get('Dos nuevo')!.startsWith('### Requirement: Dos nuevo')).toBe(true);
  });

  it('blocks: cada requisito lleva su texto y no el del siguiente; un MODIFIED sustituye el bloque', () => {
    const { blocks } = effectiveSpec('cap', tree());
    expect([...blocks.keys()]).toEqual(['Uno', 'Dos', 'Tres']);
    expect(blocks.get('Uno')).toBe('### Requirement: Uno\ntexto\n\n#### Scenario: A\n- **WHEN** x');
    expect(blocks.get('Dos')).toContain('nuevo');
    expect(blocks.get('Dos')).not.toContain('Scenario: C');
    expect(blocks.get('Tres')).toContain('Scenario: D');
  });
});

describe('parseBlocks', () => {
  it('corta el bloque en el siguiente encabezado de sección', () => {
    const blocks = parseBlocks('### Requirement: A\ncuerpo\n\n## ADDED Requirements\n\n### Requirement: B\notro');
    expect(blocks.get('A')).toBe('### Requirement: A\ncuerpo');
    expect(blocks.get('B')).toBe('### Requirement: B\notro');
  });
});
