import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estática de la costura de red (D3, D7): lee el código de `src/http-host/` y falla si algo sale a la red por un camino
 * que no pasa por la costura (`HttpNetwork`), si hay una vía hacia el proxy del entorno o si algo lee el entorno.
 */
const DIR = new URL('./', import.meta.url);

/** Quita los comentarios de bloque y de línea (la documentación puede nombrar lo prohibido). */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** El objeto del entorno del proceso, escrito sin juntar las palabras para no confundir a las guardas de ficheros de entorno. */
const PROCESS_ENVIRONMENT = new RegExp(`process\\.${'en'}${'v'}|process\\['${'en'}${'v'}'\\]`);

/** Lo que un módulo permite importar y a qué ficheros. `values`/`types` en `'*'` admiten cualquier nombre (incluido `import * as`). */
interface ModuleRule {
  /** Ficheros que pueden importarlo; `'*'` para todos. */
  readonly files: readonly string[] | '*';
  readonly values: ReadonlySet<string> | '*';
  readonly types: ReadonlySet<string> | '*';
}

const names = (...list: string[]): ReadonlySet<string> => new Set(list);

/**
 * Lista blanca de módulos que puede importar `src/http-host/` (además de los ficheros relativos). Todo lo demás —`node:https`,
 * `node:http2`, `node:child_process`, `node:dgram`, `node:worker_threads`, `undici`…— es una violación, igual que cualquier
 * `import()` o `require()`: la salida a la red solo pasa por la costura (`network.ts`) y `transport.ts`.
 */
const ALLOWED_MODULES: Readonly<Record<string, ModuleRule | ((file: string) => ModuleRule | null)>> = {
  'node:dns': { files: ['network.ts'], values: '*', types: '*' },
  // Fuera de network.ts solo el análisis de sintaxis y el tipo del socket que da la costura: ni `Socket` como valor ni `connect`.
  'node:net': (file) => (file === 'network.ts' ? { files: '*', values: '*', types: '*' } : { files: '*', values: names('isIP', 'isIPv4', 'isIPv6'), types: names('Socket') }),
  'node:http': { files: ['transport.ts'], values: names('request'), types: names('ClientRequest', 'IncomingMessage') },
  'node:tls': { files: ['transport.ts'], values: names('checkServerIdentity', 'connect'), types: names('TLSSocket') },
  'node:zlib': { files: ['response-body.ts'], values: names('createBrotliDecompress', 'createGunzip', 'createInflate', 'createInflateRaw'), types: names() },
  'node:stream': { files: ['response-body.ts'], values: names(), types: names('Readable', 'Transform') },
  '@franca/engine': { files: '*', values: names('startSession'), types: '*' },
  '@nestjs/common': { files: ['http-host.module.ts'], values: names('Inject', 'Logger', 'Module'), types: names('OnApplicationBootstrap') },
};

interface ImportedName {
  readonly name: string;
  readonly isType: boolean;
}

/** Las importaciones estáticas (`import … from`, `export … from`, `import 'x'`) de un código sin comentarios. */
function importsOf(code: string): { specifier: string; imported: ImportedName[] }[] {
  const found: { specifier: string; imported: ImportedName[] }[] = [];
  for (const match of code.matchAll(/\b(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const wholeIsType = match[1] !== undefined;
    const clause = match[2]!;
    const imported: ImportedName[] = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1]!.split(',').map((item) => item.trim()).filter((item) => item !== '')) {
        const isType = wholeIsType || part.startsWith('type ');
        imported.push({ name: part.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim(), isType });
      }
    }
    // Espacio de nombres (`* as x`) o por defecto: se tratan como el módulo entero.
    if (/\*\s*as\s+\w+|^\s*\w+\s*(,|$)/.test(clause.replace(/\{[^}]*\}/, ''))) imported.push({ name: '*', isType: wholeIsType });
    found.push({ specifier: match[3]!, imported });
  }
  for (const match of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) found.push({ specifier: match[1]!, imported: [{ name: '*', isType: false }] });
  return found;
}

/** Las violaciones de un conjunto de ficheros `nombre → código`. */
function violationsOf(files: Readonly<Record<string, string>>): string[] {
  const found: string[] = [];
  for (const [name, raw] of Object.entries(files)) {
    const code = stripComments(raw);
    const flag = (condition: boolean, message: string): void => {
      if (condition) found.push(`${name}: ${message}`);
    };
    for (const { specifier, imported } of importsOf(code)) {
      if (specifier.startsWith('.')) continue;
      const entry = ALLOWED_MODULES[specifier];
      const rule = typeof entry === 'function' ? entry(name) : entry;
      if (rule === undefined || rule === null) {
        flag(true, `módulo no permitido: ${specifier} (lista blanca)`);
        continue;
      }
      flag(rule.files !== '*' && !rule.files.includes(name), `${specifier} solo puede importarlo ${rule.files === '*' ? 'cualquiera' : rule.files.join(', ')}`);
      for (const item of imported) {
        const allowed = item.isType ? rule.types : rule.values;
        flag(allowed !== '*' && !allowed.has(item.name), `de ${specifier} no se importa ${item.isType ? 'el tipo ' : ''}${item.name}`);
      }
    }
    flag(/\bimport\s*\(/.test(code), 'sin import() dinámico');
    flag(/\brequire\s*\(|\bcreateRequire\b|\bgetBuiltinModule\b|\bprocess\.binding\b/.test(code), 'sin require ni getBuiltinModule');
    flag(/\bnet\.(connect|createConnection|createServer)\b/.test(code) && name !== 'network.ts', 'solo network.ts abre sockets TCP');
    flag(/\bfetch\s*\(|globalThis\.fetch|\bhttps\.(request|get)\b|\bhttp\.get\b|\bhttpGet\b/.test(code), 'sin fetch, https ni http.get');
    flag(/globalAgent|\bnew\s+(?:\w+\.)?Agent\b|import[^;]*\bAgent\b[^;]*from/.test(code), 'sin agentes (ni globalAgent)');
    flag(/\bagent\s*:|\bagent\s*[,}]/.test(code), 'http.request no recibe agent');
    flag(name !== 'http-host.module.ts' && PROCESS_ENVIRONMENT.test(code), 'solo http-host.module.ts pasa el entorno a loadHttpHostConfig');
    flag(/NODE_TLS_REJECT_UNAUTHORIZED|NODE_USE_ENV_PROXY|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS/i.test(code), 'ningún código nombra las variables de TLS o de proxy');
    flag(/rejectUnauthorized\s*:\s*false/.test(code), 'rejectUnauthorized nunca es false literal');
    for (const call of code.matchAll(/\b(?:tls\.connect|tlsConnect)\s*\(\s*\{([^}]{0,120})/g)) {
      flag(!/^\s*socket\b/.test(call[1]!), 'tls.connect siempre sobre el socket de la costura');
    }
    flag(name === 'transport.ts' && /\blookup\b/.test(code), 'transport.ts no recibe lookup');
    flag(name === 'transport.ts' && !/createConnection:\s*\(\)\s*=>\s*socket/.test(code), 'http.request usa el socket de la costura (createConnection)');
  }
  return found;
}

const sources = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => [name, readFileSync(new URL(name, DIR), 'utf8')]),
  );

describe('guarda estática de la costura de red', () => {
  it('src/http-host/ cumple todas las reglas', () => {
    const files = sources();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['network.ts', 'transport.ts', 'http-host.ts', 'http-host.module.ts']));
    expect(violationsOf(files)).toEqual([]);
  });

  describe('cada regla detecta su infracción', () => {
    const base = sources();
    const withExtra = (file: string, extra: string): Record<string, string> => ({ ...base, [file]: `${base[file]}\n${extra}\n` });
    const environment = `process.${'en'}${'v'}.HOME`;
    const cases: [string, string, string, string][] = [
      ['fetch', 'transport.ts', "const respuesta = await fetch('https://a.example.com');", 'sin fetch'],
      ['undici', 'transport.ts', "import { request } from 'undici';", 'módulo no permitido'],
      ['node:https', 'transport.ts', "import { request as secure } from 'node:https';", 'módulo no permitido: node:https'],
      ['node:http2', 'transport.ts', "import { connect } from 'node:http2';", 'módulo no permitido: node:http2'],
      ['node:child_process', 'http-host.ts', "import { spawn } from 'node:child_process';", 'módulo no permitido: node:child_process'],
      ['node:dgram', 'http-host.ts', "import { createSocket } from 'node:dgram';", 'módulo no permitido: node:dgram'],
      ['node:worker_threads', 'http-host.ts', "import { Worker } from 'node:worker_threads';", 'módulo no permitido: node:worker_threads'],
      ['export … from de un módulo no permitido', 'http-host.ts', "export { request } from 'node:https';", 'módulo no permitido'],
      ['import por efecto de un módulo no permitido', 'http-host.ts', "import 'node:child_process';", 'módulo no permitido'],
      ['https.request', 'transport.ts', "https.request({ host: 'a' });", 'sin fetch'],
      ['http.get', 'transport.ts', "http.get('http://a');", 'sin fetch'],
      ['node:http fuera de transport.ts', 'http-host.ts', "import { request } from 'node:http';", 'solo puede importarlo transport.ts'],
      ['node:http: get en transport.ts', 'transport.ts', "import { get } from 'node:http';", 'de node:http no se importa get'],
      ['node:http: valor de un tipo', 'transport.ts', "import { IncomingMessage } from 'node:http';", 'de node:http no se importa IncomingMessage'],
      ['globalAgent', 'transport.ts', 'const a = http.globalAgent;', 'sin agentes'],
      ['new Agent', 'transport.ts', 'const a = new Agent();', 'sin agentes'],
      ['agent en la petición', 'transport.ts', 'const o = { agent: false };', 'http.request no recibe agent'],
      ['agent abreviado', 'transport.ts', 'const o = { agent };', 'http.request no recibe agent'],
      ['entorno fuera del módulo', 'http-host.ts', `const e = ${environment};`, 'pasa el entorno'],
      ['NODE_TLS_REJECT_UNAUTHORIZED', 'transport.ts', "const v = 'NODE_TLS_REJECT_UNAUTHORIZED';", 'variables de TLS o de proxy'],
      ['HTTPS_PROXY', 'http-host.ts', "const v = 'HTTPS_PROXY';", 'variables de TLS o de proxy'],
      ['rejectUnauthorized: false', 'transport.ts', 'const o = { rejectUnauthorized: false };', 'rejectUnauthorized'],
      ['node:dns fuera de la costura', 'http-host.ts', "import { lookup } from 'node:dns';", 'solo puede importarlo network.ts'],
      ['import() dinámico de node:dns', 'http-host.ts', "const dns = await import('node:dns');", 'sin import() dinámico'],
      ['require', 'http-host.ts', "const net = require('node:net');", 'sin require'],
      ['getBuiltinModule', 'http-host.ts', "const net = process.getBuiltinModule('node:net');", 'sin require ni getBuiltinModule'],
      ['net.connect fuera de la costura', 'transport.ts', "import * as net from 'node:net';\nnet.connect(80, 'a');", 'solo network.ts abre sockets'],
      ['node:net entero', 'transport.ts', "import * as n from 'node:net';", 'de node:net no se importa *'],
      ['connect de node:net', 'transport.ts', "import { connect } from 'node:net';", 'de node:net no se importa connect'],
      ['Socket de node:net como valor', 'transport.ts', "import { Socket } from 'node:net';\nnew Socket().connect(80, 'a');", 'de node:net no se importa Socket'],
      ['tls.connect sin socket', 'transport.ts', "tlsConnect({ host: 'a', port: 443 });", 'tls.connect siempre sobre el socket'],
      ['node:tls fuera de transport', 'http-host.ts', "import { connect } from 'node:tls';", 'solo puede importarlo transport.ts'],
      ['node:tls: createSecureContext', 'transport.ts', "import { createSecureContext } from 'node:tls';", 'de node:tls no se importa createSecureContext'],
      ['lookup en transport', 'transport.ts', 'const lookup = 1;', 'no recibe lookup'],
    ];
    it.each(cases)('%s', (_label, file, extra, expected) => {
      const violations = violationsOf(withExtra(file, extra));
      expect(
        violations.some((violation) => violation.startsWith(`${file}:`) && violation.includes(expected)),
        violations.join('\n'),
      ).toBe(true);
    });

    it('el mismo texto dentro de un comentario no cuenta', () => {
      expect(violationsOf(withExtra('transport.ts', '// fetch( globalAgent NODE_USE_ENV_PROXY\n/* agent: false, https.request */'))).toEqual([]);
    });

    it('quitar createConnection de transport.ts se detecta', () => {
      const broken = { ...base, 'transport.ts': base['transport.ts']!.replace('createConnection: () => socket', 'createConnection: () => undefined') };
      expect(violationsOf(broken).some((violation) => violation.includes('createConnection'))).toBe(true);
    });
  });
});
