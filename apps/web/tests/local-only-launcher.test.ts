import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatNodeOptions, getParsedNodeOptions } from 'next/dist/server/lib/utils';

const WEB = fileURLToPath(new URL('..', import.meta.url));

// Un árbol temporal con el lanzador, el preload y un `next` simulado. El nombre lleva espacios a propósito: el
// `NODE_OPTIONS` tiene que citar la ruta del preload.
let root: string;
let marker: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'franca launcher ')));
  marker = join(root, 'next-ran.json');
  for (const file of ['scripts/local-only.mjs', 'scripts/local-only-preload.cjs', 'src/server/config/api-url.mjs', 'src/server/config/local-host.cjs']) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    cpSync(join(WEB, file), join(root, file));
  }
  mkdirSync(join(root, 'node_modules/next/dist/bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules/next/package.json'), '{"name":"next","version":"0.0.0-fake"}');
  writeFileSync(
    join(root, 'node_modules/next/dist/bin/next'),
    `#!/usr/bin/env node
const fs = require('node:fs');
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(marker + '.sigterm')}, 'sí'); process.exit(0); });
process.on('SIGINT', () => { fs.writeFileSync(${JSON.stringify(marker + '.sigint')}, 'sí'); process.exit(0); });
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), nodeOptions: process.env.NODE_OPTIONS ?? null, api: process.env.FRANCA_API_URL ?? null }));
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
if (process.env.FAKE_WAIT) setInterval(() => {}, 1000);
`,
  );
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string | undefined> = {}) {
  rmSync(marker, { force: true });
  const base: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) base[key] = value;
  const result = spawnSync(process.execPath, [join(root, 'scripts/local-only.mjs'), ...args], { env: base, encoding: 'utf8', timeout: 20_000 });
  const ran = existsSync(marker) ? (JSON.parse(readFileSync(marker, 'utf8')) as { argv: string[]; nodeOptions: string | null; api: string | null }) : null;
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, ran };
}

describe('lanzador local-only', () => {
  it('ejecuta next con los argumentos recibidos y el --require del preload en NODE_OPTIONS', () => {
    const { status, ran } = run(['start', '--hostname', '127.0.0.1', '--port', '3000']);
    expect(status).toBe(0);
    expect(ran?.argv).toEqual(['start', '--hostname', '127.0.0.1', '--port', '3000']);
    expect(ran?.nodeOptions).toBe(`--require="${join(root, 'scripts/local-only-preload.cjs')}"`);
  });

  it('dev también pasa por el lanzador', () => {
    expect(run(['dev', '--port', '3000']).ran?.argv).toEqual(['dev', '--port', '3000']);
  });

  it('conserva el NODE_OPTIONS que ya hubiera, sin pisarlo', () => {
    const { ran } = run(['start'], { NODE_OPTIONS: '--max-old-space-size=2048' });
    expect(ran?.nodeOptions).toBe(`--max-old-space-size=2048 --require="${join(root, 'scripts/local-only-preload.cjs')}"`);
  });

  it('el NODE_OPTIONS resultante sobrevive a getParsedNodeOptions y formatNodeOptions de Next (la función del fork)', () => {
    const { ran } = run(['dev'], { NODE_OPTIONS: '--max-old-space-size=2048' });
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = ran!.nodeOptions!;
    try {
      const formatted = formatNodeOptions(getParsedNodeOptions()).nodeOptions;
      expect(formatted).toContain('--max-old-space-size=2048');
      expect(formatted).toContain(join(root, 'scripts/local-only-preload.cjs'));
      expect(formatted).toMatch(/--require="?[^ ]*franca launcher /);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it.each([
    'https://127.0.0.1:3001',
    'http://api.example.com:3001',
    'http://127.0.0.1:3001/v1',
    'http://u:p@127.0.0.1:3001',
    '127.0.0.1:3001',
    '',
  ])('con FRANCA_API_URL=%j sale con 1 sin lanzar next, nombrando la variable y sin repetir el valor', (value) => {
    const { status, stderr, ran } = run(['start'], { FRANCA_API_URL: value });
    expect(status).toBe(1);
    expect(ran).toBeNull();
    expect(stderr).toContain('FRANCA_API_URL');
    expect(stderr).not.toContain('api.example.com');
    if (value !== '') expect(stderr).not.toContain(value);
  });

  it('con http://localhost:3001, http://[::1]:3001 y sin la variable, arranca next', () => {
    for (const value of ['http://localhost:3001', 'http://[::1]:3001', undefined]) {
      const { status, ran } = run(['start'], { FRANCA_API_URL: value });
      expect(status, String(value)).toBe(0);
      expect(ran).not.toBeNull();
    }
  });

  it('un modo que no es dev ni start sale con 2 sin lanzar next', () => {
    const { status, ran } = run(['build']);
    expect(status).toBe(2);
    expect(ran).toBeNull();
  });

  it('propaga el código de salida de next', () => {
    expect(run(['start'], { FAKE_EXIT: '7' }).status).toBe(7);
  });

  it('reenvía SIGTERM a next y termina con su código', async () => {
    rmSync(marker + '.sigterm', { force: true });
    // Sin esto, el marcador del test anterior ya existe y el bucle de espera no espera: con la máquina cargada, SIGTERM llega
    // antes de que el lanzador instale su manejador y sale con 143 en vez de 0. El `next` simulado escribe el marcador
    // después de instalar el suyo, así que esperar al marcador nuevo es determinista.
    rmSync(marker, { force: true });
    const child = spawn(process.execPath, [join(root, 'scripts/local-only.mjs'), 'start'], { env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', FAKE_WAIT: '1' }, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    for (let waited = 0; !existsSync(marker) && waited < 100; waited++) await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    expect(await exited).toBe(0);
    clearTimeout(timer);
    expect(existsSync(marker + '.sigterm')).toBe(true);
  });
});
