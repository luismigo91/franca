import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estática de la costura de red (D3, D7): lee el código de `src/http-host/` y falla si algo sale a la red por un camino
 * que no pasa por la costura (`HttpNetwork`), si hay una vía hacia el proxy del entorno o si algo lee el entorno.
 */
const DIR = new URL('./', import.meta.url);

/** Quita los comentarios de bloque y de línea (la documentación puede nombrar lo prohibido). */
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SAFE_NET_NAMES = new Set(['isIP', 'isIPv4', 'isIPv6', 'Socket']);
/** El objeto del entorno del proceso, escrito sin juntar las palabras para no confundir a las guardas de ficheros de entorno. */
const PROCESS_ENVIRONMENT = new RegExp(`process\\.${'en'}${'v'}|process\\['${'en'}${'v'}'\\]`);

/** Las violaciones de un conjunto de ficheros `nombre → código`. */
function violationsOf(files: Readonly<Record<string, string>>): string[] {
  const found: string[] = [];
  for (const [name, raw] of Object.entries(files)) {
    const code = stripComments(raw);
    const flag = (condition: boolean, message: string): void => {
      if (condition) found.push(`${name}: ${message}`);
    };
    const isNetwork = name === 'network.ts';
    flag(!isNetwork && /node:dns|from 'dns'|require\('dns/.test(code), 'solo network.ts importa node:dns');
    flag(!isNetwork && /\bnet\.(connect|createConnection)\b/.test(code), 'solo network.ts abre sockets TCP');
    flag(!isNetwork && /\bnet\.createServer\b/.test(code), 'no se crean servidores');
    for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'node:net'/g)) {
      const names = match[1]!
        .split(',')
        .map((part) => part.trim().replace(/^type\s+/, ''))
        .filter((part) => part !== '');
      flag(!isNetwork && names.some((part) => !SAFE_NET_NAMES.has(part)), 'de node:net solo se importan isIP e isIPv*, y el tipo Socket');
    }
    flag(!isNetwork && /import\s+\*\s+as\s+\w+\s+from\s+'node:net'/.test(code), 'node:net no se importa entero fuera de network.ts');
    flag(/\bfetch\s*\(|globalThis\.fetch|\bundici\b|from 'node:https'|\bhttps\.(request|get)\b|\bhttp\.get\b|\bhttpGet\b/.test(code), 'sin fetch, undici, https ni http.get');
    flag(/globalAgent|\bnew\s+(?:\w+\.)?Agent\b|import[^;]*\bAgent\b[^;]*from/.test(code), 'sin agentes (ni globalAgent)');
    flag(/\bagent\s*:|\bagent\s*[,}]/.test(code), 'http.request no recibe agent');
    flag(name !== 'http-host.module.ts' && PROCESS_ENVIRONMENT.test(code), 'solo http-host.module.ts pasa el entorno a loadHttpHostConfig');
    flag(/NODE_TLS_REJECT_UNAUTHORIZED|NODE_USE_ENV_PROXY|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS/i.test(code), 'ningún código nombra las variables de TLS o de proxy');
    flag(/rejectUnauthorized\s*:\s*false/.test(code), 'rejectUnauthorized nunca es false literal');
    for (const call of code.matchAll(/\b(?:tls\.connect|tlsConnect)\s*\(\s*\{([^}]{0,120})/g)) {
      flag(!/^\s*socket\b/.test(call[1]!), 'tls.connect siempre sobre el socket de la costura');
    }
    flag(name !== 'transport.ts' && /\b(?:tls\.connect|tlsConnect)\s*\(/.test(code), 'solo transport.ts envuelve en TLS');
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
      ['undici', 'transport.ts', "import { request } from 'undici';", 'sin fetch'],
      ['https.request', 'transport.ts', "https.request({ host: 'a' });", 'sin fetch'],
      ['http.get', 'transport.ts', "http.get('http://a');", 'sin fetch'],
      ['globalAgent', 'transport.ts', 'const a = http.globalAgent;', 'sin agentes'],
      ['new Agent', 'transport.ts', 'const a = new Agent();', 'sin agentes'],
      ['agent en la petición', 'transport.ts', 'const o = { agent: false };', 'http.request no recibe agent'],
      ['agent abreviado', 'transport.ts', 'const o = { agent };', 'http.request no recibe agent'],
      ['entorno fuera del módulo', 'http-host.ts', `const e = ${environment};`, 'pasa el entorno'],
      ['NODE_TLS_REJECT_UNAUTHORIZED', 'transport.ts', "const v = 'NODE_TLS_REJECT_UNAUTHORIZED';", 'variables de TLS o de proxy'],
      ['HTTPS_PROXY', 'http-host.ts', "const v = 'HTTPS_PROXY';", 'variables de TLS o de proxy'],
      ['rejectUnauthorized: false', 'transport.ts', 'const o = { rejectUnauthorized: false };', 'rejectUnauthorized'],
      ['node:dns fuera de la costura', 'http-host.ts', "import { lookup } from 'node:dns';", 'node:dns'],
      ['net.connect fuera de la costura', 'transport.ts', "import * as net from 'node:net';\nnet.connect(80, 'a');", 'solo network.ts abre sockets'],
      ['node:net entero', 'transport.ts', "import * as n from 'node:net';", 'no se importa entero'],
      ['connect de node:net', 'transport.ts', "import { connect } from 'node:net';", 'solo se importan isIP'],
      ['tls.connect sin socket', 'transport.ts', "tlsConnect({ host: 'a', port: 443 });", 'tls.connect siempre sobre el socket'],
      ['tls.connect fuera de transport', 'http-host.ts', 'tlsConnect({ socket });', 'solo transport.ts envuelve'],
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
