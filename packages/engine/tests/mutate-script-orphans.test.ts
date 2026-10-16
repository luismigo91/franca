import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// QA independiente de scripts/mutate.mjs: un mutante con un bucle infinito agota el tiempo; el script mata a
// Vitest pero no a los procesos que Vitest lanzó (los workers del pool `forks`), que siguen al 100 % de CPU
// con el padre 1. Se vio en la máquina tras una ejecución de `mutate`: workers de hasta 6 horas.
// Mismo montaje que mutate-script.test.ts: un proyecto de juguete con un «Vitest» falso.
const SCRIPT = new URL('../scripts/mutate.mjs', import.meta.url).pathname;
let dir: string;
let worker: number | null = null;

/** El Vitest falso lanza un «worker» (un nodo con un bucle de espera) y se cuelga, como un Vitest con un bucle infinito. */
const FAKE_VITEST = `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const source = readFileSync('src/a.js', 'utf8');
if (source.includes('x = 7')) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync('worker.pid', String(child.pid));
  setTimeout(() => process.exit(0), 30000);
} else {
  process.exit(0);
}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mutate-orphans-'));
  for (const sub of ['scripts', 'src', 'tests']) mkdirSync(join(dir, sub));
  copyFileSync(SCRIPT, join(dir, 'scripts/mutate.mjs'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'src/a.js'), 'export const x = 1;\n');
  writeFileSync(join(dir, 'tests/a.test.js'), '');
  writeFileSync(join(dir, 'fake-vitest.cjs'), FAKE_VITEST);
  chmodSync(join(dir, 'fake-vitest.cjs'), 0o755);
});

afterEach(() => {
  // Nunca dejamos el worker de la prueba vivo, pase o falle.
  if (worker !== null) {
    try {
      process.kill(worker, 'SIGKILL');
    } catch {
      // ya había muerto
    }
  }
  worker = null;
  rmSync(dir, { recursive: true, force: true });
});

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('scripts/mutate.mjs: procesos que lanza Vitest', { timeout: 30_000 }, () => {
  async function runWithTimeout(): Promise<number> {
    writeFileSync(join(dir, 'mutations.json'), JSON.stringify([{ id: 'bucle', file: 'src/a.js', find: 'x = 1', replace: 'x = 7', tests: ['tests/a.test.js'] }]));
    const child = spawn(process.execPath, [join(dir, 'scripts/mutate.mjs')], {
      cwd: dir,
      env: { ...process.env, MUTATE_VITEST: join(dir, 'fake-vitest.cjs'), MUTATE_MUTATIONS: join(dir, 'mutations.json'), MUTATE_TIMEOUT_MS: '600' },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    expect(code, out).toBe(0);
    expect(out).toContain('muerta (timeout)');
    expect(existsSync(join(dir, 'worker.pid'))).toBe(true);
    worker = Number(readFileSync(join(dir, 'worker.pid'), 'utf8'));
    // Bajo carga el sistema tarda en entregar el SIGKILL al grupo: se espera hasta 5 s a que muera, en vez de un
    // margen fijo que daba falsos rojos. Un huérfano de verdad sigue vivo indefinidamente, así que no se pierde nada.
    for (let waited = 0; waited < 5000 && isAlive(worker); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
    return worker;
  }

  // Arreglado: mutate.mjs lanza Vitest con `detached` y mata el grupo entero (`process.kill(-pid, 'SIGKILL')`).
  it('tras agotar el tiempo de un mutante no queda vivo ningún proceso lanzado por Vitest', async () => {
    const pid = await runWithTimeout();
    expect(isAlive(pid), `el worker ${pid} sigue vivo`).toBe(false);
  });

  it('la mutación se restaura aunque se agote el tiempo (lo que sí hace bien)', async () => {
    await runWithTimeout();
    expect(readFileSync(join(dir, 'src/a.js'), 'utf8')).toBe('export const x = 1;\n');
    expect(existsSync(join(dir, '.mutate-backup'))).toBe(false);
  });
});
