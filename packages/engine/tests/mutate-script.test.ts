import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Se prueba scripts/mutate.mjs en un proyecto de juguete con un «Vitest» falso: ninguna prueba toca el árbol real.
const SCRIPT = new URL('../scripts/mutate.mjs', import.meta.url).pathname;
const ORIGINAL = 'export const x = 1;\n';
let dir: string;

/** Ejecutable falso de Vitest: su veredicto depende del contenido de src/a.js (y de FAKE_MODE). */
const FAKE_VITEST = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const source = readFileSync('src/a.js', 'utf8');
if (process.env.FAKE_MODE === 'baseline-roto') process.exit(1);
if (process.env.FAKE_MODE === 'senal' && source.includes('x = 2')) process.kill(process.pid, 'SIGKILL');
if (source.includes('x = 8')) { writeFileSync('running', 'si'); setTimeout(() => process.exit(0), 30000); }
else if (source.includes('x = 9')) { setTimeout(() => process.exit(0), 30000); }
else process.exit(source.includes('x = 2') ? 1 : 0);
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutate-'));
  for (const sub of ['scripts', 'src', 'tests']) mkdirSync(join(dir, sub));
  copyFileSync(SCRIPT, join(dir, 'scripts/mutate.mjs'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'src/a.js'), ORIGINAL);
  writeFileSync(join(dir, 'tests/a.test.js'), '');
  writeFileSync(join(dir, 'fake-vitest.cjs'), FAKE_VITEST);
  chmodSync(join(dir, 'fake-vitest.cjs'), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mutation = (id: string, replace: string) => ({ id, file: 'src/a.js', find: 'x = 1', replace, tests: ['tests/a.test.js'] });

function launch(mutations: unknown[], env: Record<string, string> = {}): { child: ChildProcess; done: Promise<{ code: number | null; out: string }> } {
  writeFileSync(join(dir, 'mutations.json'), JSON.stringify(mutations));
  const child = spawn(process.execPath, [join(dir, 'scripts/mutate.mjs')], {
    cwd: dir,
    env: { ...process.env, MUTATE_VITEST: join(dir, 'fake-vitest.cjs'), MUTATE_MUTATIONS: join(dir, 'mutations.json'), ...env },
  });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const done = new Promise<{ code: number | null; out: string }>((resolve) => child.on('close', (code) => resolve({ code, out })));
  return { child, done };
}

const source = () => readFileSync(join(dir, 'src/a.js'), 'utf8');

describe('scripts/mutate.mjs', { timeout: 30_000 }, () => {
  it('una mutación que algún test mata: código 0 y el fichero queda igual', async () => {
    const { done } = launch([mutation('mata', 'x = 2')]);
    const { code, out } = await done;
    expect(code, out).toBe(0);
    expect(out).toContain('1/1 mutaciones muertas');
    expect(source()).toBe(ORIGINAL);
    expect(existsSync(join(dir, '.mutate-backup'))).toBe(false);
  });

  it('una mutación que sobrevive: código 1', async () => {
    const { code, out } = await launch([mutation('sobrevive', 'x = 3')]).done;
    expect(code).toBe(1);
    expect(out).toContain('SOBREVIVEN: sobrevive');
    expect(source()).toBe(ORIGINAL);
  });

  it('(a) línea base rota: aborta antes de mutar y no cuenta nada como muerta', async () => {
    const { code, out } = await launch([mutation('mata', 'x = 2')], { FAKE_MODE: 'baseline-roto' }).done;
    expect(code).toBe(1);
    expect(out).toContain('línea base rota');
    expect(out).not.toContain('mutaciones muertas');
    expect(source()).toBe(ORIGINAL);
  });

  it('(b) un binario que no arranca es un error, no una mutación muerta', async () => {
    const { code, out } = await launch([mutation('mata', 'x = 2')], { MUTATE_VITEST: join(dir, 'no-existe') }).done;
    expect(code).toBe(1);
    expect(out).toContain('no se pudo ejecutar Vitest');
    expect(out).not.toContain('mutaciones muertas');
    expect(source()).toBe(ORIGINAL);
  });

  it('(b) un Vitest que muere por una señal con la mutación puesta es un error, no una mutación muerta', async () => {
    const { code, out } = await launch([mutation('señal', 'x = 2')], { FAKE_MODE: 'senal' }).done;
    expect(code).toBe(1);
    expect(out).toContain('terminado por la señal');
    expect(out).not.toContain('mutaciones muertas');
    expect(source()).toBe(ORIGINAL);
  });

  it('(c) un Vitest que no termina en el tiempo máximo cuenta como «muerta (timeout)»', async () => {
    const started = Date.now();
    const { code, out } = await launch([mutation('cuelga', 'x = 9')], { MUTATE_TIMEOUT_MS: '700' }).done;
    expect(code, out).toBe(0);
    expect(out).toContain('muerta (timeout)');
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(source()).toBe(ORIGINAL);
  });

  it('(d) SIGINT a mitad de una mutación restaura el fichero y sale con 130', async () => {
    const { child, done } = launch([mutation('largo', 'x = 8')]);
    for (let waited = 0; !existsSync(join(dir, 'running')) && waited < 10_000; waited += 25) await new Promise((r) => setTimeout(r, 25));
    expect(existsSync(join(dir, 'running')), 'la mutación llegó a ejecutarse').toBe(true);
    expect(source()).toContain('x = 8'); // el fichero está mutado en este momento
    child.kill('SIGINT');
    const { code } = await done;
    expect(code).toBe(130);
    expect(source()).toBe(ORIGINAL);
    expect(existsSync(join(dir, '.mutate-backup'))).toBe(false);
  }, 20_000);

  it('(d) SIGTERM también restaura', async () => {
    const { child, done } = launch([mutation('largo', 'x = 8')]);
    for (let waited = 0; !existsSync(join(dir, 'running')) && waited < 10_000; waited += 25) await new Promise((r) => setTimeout(r, 25));
    child.kill('SIGTERM');
    expect((await done).code).toBe(130);
    expect(source()).toBe(ORIGINAL);
  }, 20_000);

  it('un «find» que no aparece exactamente una vez aborta sin tocar nada', async () => {
    const { code, out } = await launch([{ ...mutation('obsoleta', 'x = 2'), find: 'NO EXISTE' }]).done;
    expect(code).toBe(1);
    expect(out).toContain('obsoleto');
    expect(source()).toBe(ORIGINAL);
  });

  it('recupera la copia de una ejecución que se mató a medias y se detiene', async () => {
    mkdirSync(join(dir, '.mutate-backup'));
    writeFileSync(join(dir, '.mutate-backup', encodeURIComponent('src/a.js')), ORIGINAL);
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 2;\n');
    const { code, out } = await launch([mutation('mata', 'x = 2')]).done;
    expect(code).toBe(1);
    expect(out).toContain('restaurado src/a.js');
    expect(source()).toBe(ORIGINAL);
  });
});
