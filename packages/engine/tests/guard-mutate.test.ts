import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/guard-mutate.mjs de la raíz: el candado que impide compilar o verificar mientras `mutate` tiene
// ficheros de `src/` reescritos. El script resuelve la raíz desde su propia ubicación: se copia a un árbol de juguete.
const SCRIPT = new URL('../../../scripts/guard-mutate.mjs', import.meta.url).pathname;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guard-mutate-'));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'packages/a'), { recursive: true });
  mkdirSync(join(dir, 'packages/b'), { recursive: true });
  mkdirSync(join(dir, 'apps/api'), { recursive: true });
  mkdirSync(join(dir, 'apps/web'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts/guard-mutate.mjs'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const guard = () => spawnSync(process.execPath, [join(dir, 'scripts/guard-mutate.mjs')], { encoding: 'utf8' });

describe('scripts/guard-mutate.mjs', () => {
  it('sin copias de mutación, deja pasar', () => {
    const result = guard();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('con packages/*/.mutate-backup/ falla con el mensaje de mutación en curso y nombra el paquete', () => {
    mkdirSync(join(dir, 'packages/b/.mutate-backup'));
    const result = guard();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mutación en curso: espera a que termine `mutate`');
    expect(result.stderr).toContain('packages/b');
    expect(result.stderr).not.toContain('packages/a');
    expect(result.stderr).not.toContain('apps/');
  });

  it('con apps/*/.mutate-backup/ también falla, nombra la app y no las demás', () => {
    mkdirSync(join(dir, 'apps/api/.mutate-backup'));
    const result = guard();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mutación en curso: espera a que termine `mutate`');
    expect(result.stderr).toContain('apps/api/.mutate-backup/');
    expect(result.stderr).not.toContain('apps/web');
    expect(result.stderr).not.toContain('packages/');
  });

  it('el script check y el script build de la raíz lo ejecutan primero', async () => {
    const { readFileSync } = await import('node:fs');
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
    expect(root.scripts.check!.startsWith('node scripts/guard-mutate.mjs && ')).toBe(true);
    expect(root.scripts.build!.startsWith('node scripts/guard-mutate.mjs && ')).toBe(true);
  });
});
