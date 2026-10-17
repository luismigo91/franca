#!/usr/bin/env node
// @ts-check
// Lanzador de `pnpm dev` y `pnpm start` (D5, D26): valida `FRANCA_API_URL` ANTES de ejecutar `next` (Next escucha antes de
// cargar su configuración, así que no puede hacerlo él) y carga el preload de la guarda local en todo el árbol de procesos.
//
// Uso: node scripts/local-only.mjs <dev|start> --hostname 127.0.0.1 --port 3000
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ApiUrlError, parseApiUrl } from '../src/server/config/api-url.mjs';

const [mode, ...args] = process.argv.slice(2);
if (mode !== 'dev' && mode !== 'start') {
  process.stderr.write('Uso: node scripts/local-only.mjs <dev|start> [opciones de next]\n');
  process.exit(2);
}

try {
  parseApiUrl(process.env.FRANCA_API_URL);
} catch (error) {
  // El mensaje nombra la variable y nunca repite el valor.
  process.stderr.write(`${error instanceof ApiUrlError ? error.message : 'FRANCA_API_URL no es válida.'}\n`);
  process.exit(1);
}

const preload = fileURLToPath(new URL('./local-only-preload.cjs', import.meta.url));
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
// Se añade al NODE_OPTIONS que haya, sin pisarlo. Las comillas permiten rutas con espacios.
const nodeOptions = [process.env.NODE_OPTIONS, `--require="${preload}"`].filter(Boolean).join(' ');

const child = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  process.stderr.write(`No se pudo ejecutar next: ${error.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
});
