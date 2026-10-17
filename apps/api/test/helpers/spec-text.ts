import { existsSync, readdirSync, readFileSync } from 'node:fs';

const OPENSPEC = new URL('../../../../openspec/', import.meta.url);


/** requisito → escenarios, en el orden del texto. */
export type Requirements = Map<string, string[]>;

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
 * más los deltas de `openspec/changes/*` (sin `archive`), donde `ADDED` añade y `MODIFIED` sustituye
 * un requisito por su título. Así un test ligado a la spec vale antes de archivar el cambio (el
 * requisito solo está en el delta) y después (ya está en la vigente).
 *
 * @param capability Carpeta de la capacidad, p. ej. `flow-engine`.
 * @param root Carpeta `openspec/` (por defecto la del repo; los tests del propio cargador usan una temporal).
 * @returns Los requisitos con sus escenarios y el texto de la vigente seguido del de cada delta.
 */
export function effectiveSpec(capability: string, root: URL = OPENSPEC): { requirements: Requirements; text: string } {
  const mainUrl = new URL(`specs/${capability}/spec.md`, root);
  const main = existsSync(mainUrl) ? readFileSync(mainUrl, 'utf8') : '';
  const requirements = parseRequirements(main);
  const deltas = activeDeltas(capability, root);
  for (const delta of deltas) {
    for (const [title, scenarios] of parseRequirements(delta)) requirements.set(title, scenarios);
  }
  return { requirements, text: [main, ...deltas].join('\n') };
}
