import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../src/', import.meta.url);

/** Quita comentarios de bloque y de línea (un `//` precedido por `:` es parte de una URL). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: URL = SRC): { path: string; code: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return entry.name.endsWith('.ts') ? [{ path: url.pathname.split('/src/')[1]!, code: stripComments(readFileSync(url, 'utf8')) }] : [];
  });
}

const files = sourceFiles();
const offenders = (token: RegExp): string[] => files.filter((file) => token.test(file.code)).map((file) => file.path);

describe('guarda estática de src/', () => {
  it('hay código que revisar', () => {
    expect(files.map((f) => f.path).sort()).toEqual(['client.ts', 'cost.ts', 'errors.ts', 'index.ts', 'models.ts', 'options.ts', 'output.ts', 'prompt.ts', 'provider.ts', 'read.ts']);
  });

  it('Sin claves en el paquete', () => {
    // El prefijo de las claves de Anthropic, lecturas del entorno y asignaciones de apiKey.
    expect(offenders(/sk-ant-/)).toEqual([]);
    expect(offenders(/\bprocess\s*\.\s*env\b/)).toEqual([]);
    expect(offenders(/\bapiKey\s*[:=]/)).toEqual([]);
    expect(offenders(/\bauthToken\s*[:=]/)).toEqual([]);
  });

  it('el paquete no escribe en consola', () => {
    expect(offenders(/\bconsole\b/)).toEqual([]);
  });

  it('un error no se serializa ni se copia a un resultado o aviso', () => {
    expect(offenders(/JSON\s*\.\s*stringify\s*\(\s*(e|err|error)\b/)).toEqual([]);
    expect(offenders(/\b(e|err|error)\s*\.\s*(message|body|headers|error)\b/)).toEqual([]);
  });

  it('no usa el entorno ni el sistema de ficheros', () => {
    expect(offenders(/\b(process|require)\b/)).toEqual([]);
    expect(offenders(/['"`]node:/)).toEqual([]);
  });
});
