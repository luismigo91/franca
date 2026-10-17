import { existsSync, readdirSync, readFileSync } from 'node:fs';

const OPENSPEC = new URL('../../../../openspec/', import.meta.url);


/** requisito → escenarios, en el orden del texto. */
export type Requirements = Map<string, string[]>;

/** requisito → su texto entero (desde la línea `### Requirement:` hasta el siguiente requisito o sección). */
export type Blocks = Map<string, string>;

/** Lee los `### Requirement:` y sus `#### Scenario:` de un texto de spec. */
export function parseRequirements(text: string): Requirements {
  const requirements: Requirements = new Map();
  let current: string[] | undefined;
  for (const line of text.split('\n')) {
    const requirement = /^### Requirement: (.+)$/.exec(line);
    if (requirement) {
      current = [];
      requirements.set(requirement[1]!, current);
      continue;
    }
    const scenario = /^#### Scenario: (.+)$/.exec(line);
    if (scenario && current) current.push(scenario[1]!);
  }
  return requirements;
}

/** Lee el texto de cada `### Requirement:` de un texto de spec, por título. */
export function parseBlocks(text: string): Blocks {
  const blocks: Blocks = new Map();
  let title: string | undefined;
  let lines: string[] = [];
  const close = () => {
    if (title !== undefined) blocks.set(title, lines.join('\n').trimEnd());
  };
  for (const line of text.split('\n')) {
    const requirement = /^### Requirement: (.+)$/.exec(line);
    if (requirement || line.startsWith('## ')) {
      close();
      title = requirement ? requirement[1]! : undefined;
      lines = requirement ? [line] : [];
      continue;
    }
    if (title !== undefined) lines.push(line);
  }
  close();
  return blocks;
}

type SectionKind = 'requirements' | 'ADDED' | 'MODIFIED' | 'RENAMED' | 'other';

interface Section {
  kind: SectionKind;
  text: string;
}

/**
 * Parte un texto de spec por sus encabezados `## `: `## Requirements` (la vigente) y `## ADDED|MODIFIED|RENAMED
 * Requirements` (un delta). Lo que va antes del primer encabezado cuenta como `requirements` (una spec sin secciones);
 * cualquier otra sección (`## Purpose`, `## REMOVED Requirements`) es `other` y no aporta requisitos.
 */
function splitSections(text: string): Section[] {
  const sections: Section[] = [{ kind: 'requirements', text: '' }];
  let lines: string[] = [];
  const close = () => (sections[sections.length - 1]!.text = lines.join('\n'));
  for (const line of text.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    close();
    lines = [];
    const kind = /^(ADDED|MODIFIED|RENAMED) Requirements$/.exec(heading[1]!);
    sections.push({ kind: kind ? (kind[1] as SectionKind) : heading[1] === 'Requirements' ? 'requirements' : 'other', text: '' });
  }
  close();
  return sections;
}

/** Los pares `- FROM: \`### Requirement: A\`` / `- TO: \`### Requirement: B\`` de una sección `RENAMED`. */
function parseRenames(text: string): { from: string; to: string }[] {
  const renames: { from: string; to: string }[] = [];
  let from: string | undefined;
  for (const line of text.split('\n')) {
    const source = /^- FROM:\s*`### Requirement: (.+)`\s*$/.exec(line);
    if (source) {
      from = source[1]!;
      continue;
    }
    const target = /^- TO:\s*`### Requirement: (.+)`\s*$/.exec(line);
    if (target && from !== undefined) {
      renames.push({ from, to: target[1]! });
      from = undefined;
    }
  }
  return renames;
}

/** Copia `map` con la clave `from` sustituida por `to` en la misma posición; `transform` ajusta el valor. */
function renameKey<T>(map: Map<string, T>, from: string, to: string, transform: (value: T) => T = (value) => value): Map<string, T> {
  const renamed = new Map<string, T>();
  for (const [key, value] of map) {
    if (key === from) renamed.set(to, transform(value));
    else renamed.set(key, value);
  }
  return renamed;
}

/** Los textos de `specs/<capability>/spec.md` de los cambios activos (`openspec/changes/*`, sin `archive`), por orden de nombre. */
function activeDeltas(capability: string, root: URL): string[] {
  const changes = new URL('changes/', root);
  if (!existsSync(changes)) return [];
  return readdirSync(changes, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => new URL(`changes/${entry.name}/specs/${capability}/spec.md`, root))
    .filter((url) => existsSync(url))
    .sort((a, b) => a.pathname.localeCompare(b.pathname))
    .map((url) => readFileSync(url, 'utf8'));
}

/**
 * La spec tal como queda con los cambios activos aplicados: la vigente (`openspec/specs/<capability>`)
 * más los deltas de `openspec/changes/*` (sin `archive`). Cada delta se aplica en el orden de OpenSpec: primero
 * `RENAMED` (el requisito conserva su posición), después `MODIFIED` y `ADDED` (sustituyen o añaden por título, en el
 * orden del texto). Los `- FROM:`/`- TO:` de `RENAMED` no son requisitos. `REMOVED` no se aplica: ningún cambio
 * lo usa. Así un test ligado a la spec vale antes de archivar el cambio (el requisito solo está en el delta) y
 * después (ya está en la vigente).
 *
 * @param capability Carpeta de la capacidad, p. ej. `flow-engine`.
 * @param root Carpeta `openspec/` (por defecto la del repo; los tests del propio cargador usan una temporal).
 * @returns Los requisitos con sus escenarios, el texto de cada requisito (`blocks`) y el texto de la vigente seguido del de cada delta.
 */
export function effectiveSpec(capability: string, root: URL = OPENSPEC): { requirements: Requirements; blocks: Blocks; text: string } {
  const mainUrl = new URL(`specs/${capability}/spec.md`, root);
  const main = existsSync(mainUrl) ? readFileSync(mainUrl, 'utf8') : '';
  let requirements = new Map<string, string[]>();
  let blocks = new Map<string, string>();
  for (const section of splitSections(main)) {
    if (section.kind !== 'requirements') continue;
    for (const [title, scenarios] of parseRequirements(section.text)) requirements.set(title, scenarios);
    for (const [title, block] of parseBlocks(section.text)) blocks.set(title, block);
  }
  const deltas = activeDeltas(capability, root);
  for (const delta of deltas) {
    const sections = splitSections(delta);
    for (const section of sections.filter((candidate) => candidate.kind === 'RENAMED')) {
      for (const { from, to } of parseRenames(section.text)) {
        requirements = renameKey(requirements, from, to);
        blocks = renameKey(blocks, from, to, (block) => block.replace(`### Requirement: ${from}`, `### Requirement: ${to}`));
      }
    }
    for (const section of sections.filter((candidate) => candidate.kind === 'MODIFIED' || candidate.kind === 'ADDED' || candidate.kind === 'requirements')) {
      for (const [title, scenarios] of parseRequirements(section.text)) requirements.set(title, scenarios);
      for (const [title, block] of parseBlocks(section.text)) blocks.set(title, block);
    }
  }
  return { requirements, blocks, text: [main, ...deltas].join('\n') };
}
