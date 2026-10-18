import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(WEB, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const isSource = (path: string) => /\.(ts|tsx|mjs|cjs)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path);
const sources = walk(SRC).filter(isSource);
const rel = (path: string) => relative(WEB, path);

/** El código sin comentarios: la guarda mira lo que se ejecuta, no lo que se explica. */
function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(,])\/\/.*$/gm, '$1');
}

const isClient = (path: string) => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8'));

describe('guarda estática', () => {
  it('cada manejador de una ruta de la web empieza con await connection()', () => {
    const routes = sources.filter((path) => /src\/app\/api\/.*route\.ts$/.test(path));
    expect(routes.length).toBe(10);
    let handlers = 0;
    for (const path of routes) {
      const text = code(path);
      for (const match of text.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^{]*\{\s*([^;]*;)/g)) {
        handlers += 1;
        expect(match[2]!.trim(), `${rel(path)} ${match[1]}`).toBe('await connection();');
      }
      expect(text, rel(path)).not.toMatch(/export\s+(const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
    }
    expect(handlers).toBeGreaterThanOrEqual(19);
  });

  it("ningún 'use server' en src/", () => {
    for (const path of sources) expect(readFileSync(path, 'utf8'), rel(path)).not.toMatch(/['"]use server['"]/);
  });

  it('ninguna caché de Next: use cache, cacheLife, cacheTag ni unstable_cache', () => {
    for (const path of sources) expect(code(path) + readFileSync(path, 'utf8').match(/['"]use cache[^'"]*['"]/)?.[0], rel(path)).not.toMatch(/use cache|cacheLife|cacheTag|unstable_cache/);
  });

  it("ningún fichero 'use client' importa @/server/", () => {
    for (const path of sources.filter(isClient)) expect(code(path), rel(path)).not.toMatch(/from\s+['"]@\/server\//);
  });

  it('ningún componente, hook ni librería del navegador importa @/server/', () => {
    for (const path of sources.filter((candidate) => /src\/(components|hooks|lib)\//.test(candidate))) {
      expect(code(path), rel(path)).not.toMatch(/from\s+['"]@\/server\//);
    }
  });

  it('transport.ts solo lo importa operations.ts, y operations.ts exporta exactamente catorce funciones', () => {
    // Los `import type` no cuentan: no hay nada que ejecutar.
    const importers = sources
      .filter((path) => code(path).split('\n').some((line) => /^import\s+(?!type\b)[\s\S]*from\s+['"](@\/server\/api\/transport|\.\/transport)['"]/.test(line)))
      .map(rel);
    expect(importers).toEqual(['src/server/api/operations.ts']);
    const exports = [...code(join(SRC, 'server/api/operations.ts')).matchAll(/^export\s+/gm)];
    const functions = [...code(join(SRC, 'server/api/operations.ts')).matchAll(/^export\s+function\s+(\w+)/gm)];
    expect(exports).toHaveLength(14);
    expect(functions.map((match) => match[1]).sort()).toEqual([
      'createConversation',
      'createFlow',
      'deleteConversation',
      'deleteFlow',
      'getConversation',
      'getFlow',
      'getFlowVersion',
      'getTranscriptPage',
      'listConversations',
      'listFlows',
      'listPublishedFlows',
      'publishFlow',
      'sendConversationInput',
      'updateFlow',
    ]);
  });

  it('nadie más que operations.ts importa operations.ts salvo los manejadores', () => {
    const importers = sources.filter((path) => /from\s+['"]@\/server\/api\/operations['"]/.test(code(path))).map(rel);
    expect(importers).toEqual(['src/server/bff/handlers.ts']);
  });

  it('ningún cliente importa @franca/engine sin import type', () => {
    for (const path of sources.filter((candidate) => /src\/(components|hooks|lib|app)\//.test(candidate) && !/src\/app\/api\//.test(candidate))) {
      for (const line of code(path).split('\n')) {
        if (/from\s+['"]@franca\/engine['"]/.test(line) || /^import\s+['"]@franca\/engine['"]/.test(line)) {
          expect(line, `${rel(path)}: ${line}`).toMatch(/^\s*import\s+type\s/);
        }
      }
    }
  });

  it('ningún mode: en una llamada a fetch', () => {
    for (const path of sources) {
      for (const match of code(path).matchAll(/\bfetch\s*\(([\s\S]{0,300}?)\)/g)) expect(match[1], rel(path)).not.toMatch(/\bmode\s*:/);
      expect(code(path), rel(path)).not.toMatch(/mode:\s*['"](no-cors|same-origin|navigate|cors)['"]/);
    }
  });

  it('ningún <form con action= o method= (los formularios llaman a preventDefault y se envían con fetch)', () => {
    const forms = sources.flatMap((path) => [...code(path).matchAll(/<form\b[^>]*>/g)].map((match) => ({ path, tag: match[0] })));
    for (const { path, tag } of forms) expect(tag, rel(path)).not.toMatch(/\b(action|method)\s*=/);
  });

  it('la frontera no lee x-forwarded-*, nextUrl.host ni request.url', () => {
    for (const file of ['src/server/frontier.ts', 'src/proxy.ts']) {
      const text = code(join(WEB, file));
      expect(text, file).not.toMatch(/x-forwarded|forwarded/i);
      expect(text, file).not.toMatch(/nextUrl\.(host|hostname|origin|href)/);
      expect(text, file).not.toMatch(/request\.url|\.url\b/);
    }
  });

  it('proxy.ts no tiene matcher: corre en toda petición', () => {
    const text = code(join(SRC, 'proxy.ts'));
    expect(text).not.toMatch(/matcher|export\s+const\s+config/);
    expect(text).toMatch(/export\s+function\s+proxy\b/);
  });

  it('los scripts dev y start de package.json pasan por el lanzador y no usan --experimental-https', () => {
    const scripts = (JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.dev).toBe('node scripts/local-only.mjs dev --hostname 127.0.0.1 --port 3000');
    expect(scripts.start).toBe('node scripts/local-only.mjs start --hostname 127.0.0.1 --port 3000');
    for (const script of Object.values(scripts)) expect(script).not.toContain('--experimental-https');
  });

  it('no hay next/image en los componentes del chat', () => {
    for (const path of sources.filter((candidate) => candidate.includes('src/components/'))) expect(code(path), rel(path)).not.toMatch(/next\/image/);
  });

  it('el detector de formularios ve un <form con action= (control)', () => {
    expect(/<form\b[^>]*>/.exec('<form action="/x" onSubmit={f}>')![0]).toMatch(/\b(action|method)\s*=/);
  });

  it('la guarda detecta lo que prohíbe (control): un manejador sin connection() no pasaría', () => {
    const bad = 'export async function GET() { return handle(); }';
    const match = /export\s+async\s+function\s+(GET)\b[^{]*\{\s*([^;]*;)/.exec(bad);
    expect(match![2]!.trim()).not.toBe('await connection();');
  });
});

// ---- Guardas del editor (D19, D21)

/** Importaciones de `@franca/spec` de un texto de código: cada una con su sentencia entera. */
function specImports(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/import\s+(?:type\s+)?[^;'"]*?from\s+['"]@franca\/spec(?:\/[^'"]*)?['"]/g)) found.push(match[0]);
  for (const match of text.matchAll(/import\s+['"]@franca\/spec(?:\/[^'"]*)?['"]/g)) found.push(match[0]);
  for (const match of text.matchAll(/import\(\s*['"]@franca\/spec(?:\/[^'"]*)?['"]\s*\)/g)) found.push(match[0]);
  return found;
}

/** Una importación con nombre que incluye `targets` (también `targets as x`), una de espacio de nombres o dinámica. */
function reachesTargets(statement: string): boolean {
  if (/^import\(/.test(statement) || /import\s+\*\s+as\b/.test(statement)) return true;
  if (/^import\s+type\b/.test(statement)) return false;
  const named = /\{([^}]*)\}/.exec(statement)?.[1] ?? '';
  return named.split(',').some((part) => /^\s*(type\s+)?targets(\s+as\s+\w+)?\s*$/.test(part));
}

/** Un import de `@franca/spec` que no es `import type`: código que se ejecutaría. */
const isRuntimeSpecImport = (statement: string) => !/^import\s+type\b/.test(statement);

const rest = (path: string) => rel(path).replace(/\\/g, '/');
const inEditorLib = (path: string) => rest(path).startsWith('src/lib/editor/');
const inServer = (path: string) => rest(path).startsWith('src/server/') || rest(path) === 'src/proxy.ts' || rest(path).startsWith('src/app/api/');

/** Etiquetas que cargan o enlazan contenido ajeno. */
const MEDIA_TAGS = /<(img|video|audio|iframe|embed|object|source|picture|a)(?=[\s>/])/g;

function hrefsNotFromPages(text: string): string[] {
  return [...text.matchAll(/\bhref=(\{[^}]*\}|"[^"]*"|'[^']*')/g)].map((match) => match[1]!).filter((value) => !value.includes('WEB_PAGES'));
}

describe('guarda estática del editor', () => {
  it('solo src/lib/editor/node-targets.ts llega a targets de @franca/spec', () => {
    for (const path of sources.filter((candidate) => rest(candidate) !== 'src/lib/editor/node-targets.ts')) {
      for (const statement of specImports(code(path))) expect(reachesTargets(statement), `${rel(path)}: ${statement}`).toBe(false);
    }
    expect(specImports(code(join(SRC, 'lib/editor/node-targets.ts'))).some(reachesTargets)).toBe(true);
  });

  it('import * as, import() y cualquier importación con nombre que incluya targets se detectan (control)', () => {
    expect(reachesTargets("import { targets } from '@franca/spec'")).toBe(true);
    expect(reachesTargets("import { validateFlow, targets as t } from '@franca/spec'")).toBe(true);
    expect(reachesTargets("import { type targets } from '@franca/spec'")).toBe(true);
    expect(reachesTargets("import * as spec from '@franca/spec'")).toBe(true);
    expect(reachesTargets("import('@franca/spec')")).toBe(true);
    expect(reachesTargets("import { validateFlow } from '@franca/spec'")).toBe(false);
    expect(reachesTargets("import { retargets } from '@franca/spec'")).toBe(false);
    expect(specImports("import('@franca/spec')\nimport * as s from '@franca/spec'\nimport { a } from '@franca/spec/flow.schema.json'")).toHaveLength(3);
  });

  it('@franca/spec solo entra en el navegador desde src/lib/editor/** (sin import type en el resto del navegador)', () => {
    const browser = sources.filter((path) => !inEditorLib(path) && !inServer(path));
    for (const path of browser) {
      for (const statement of specImports(code(path))) expect(isRuntimeSpecImport(statement), `${rel(path)}: ${statement}`).toBe(false);
    }
    expect(isRuntimeSpecImport("import { validateFlow } from '@franca/spec'")).toBe(true);
    expect(isRuntimeSpecImport("import type { Flow } from '@franca/spec'")).toBe(false);
    expect(isRuntimeSpecImport("import schema from '@franca/spec/flow.schema.json'")).toBe(true);
  });

  it('src/components/editor/** no carga ni enlaza direcciones del flujo: ni <img, <video, <audio, <iframe, <embed, <object, <source, <picture ni <a ', () => {
    const files = sources.filter((path) => rest(path).startsWith('src/components/editor/'));
    for (const path of files) {
      expect([...code(path).matchAll(MEDIA_TAGS)].map((match) => match[0]), rel(path)).toEqual([]);
      expect(hrefsNotFromPages(code(path)), rel(path)).toEqual([]);
    }
  });

  it('las etiquetas prohibidas y un href que no sale de WEB_PAGES se detectan (control)', () => {
    for (const tag of ['<img src={x} />', '<video src={x}>', '<audio>', '<iframe src={x}>', '<embed>', '<object>', '<source>', '<picture>', '<a href="/x">', '<a\n href="/x">']) {
      expect([...tag.matchAll(MEDIA_TAGS)], tag).not.toHaveLength(0);
    }
    expect([...'<abbr title="x"><article>'.matchAll(MEDIA_TAGS)]).toHaveLength(0);
    expect(hrefsNotFromPages('<Link href="/flujos">')).toEqual(['"/flujos"']);
    expect(hrefsNotFromPages('<Link href={url}>')).toEqual(['{url}']);
    expect(hrefsNotFromPages('<Link href={WEB_PAGES.flows}>')).toEqual([]);
  });
});
