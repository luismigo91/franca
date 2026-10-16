import { describe, expect, it } from 'vitest';
import { buildRequestUrl, validateUrlText } from '../../src/http/url.js';
import type { VariableValue } from '../../src/types.js';
import { prng } from '../helpers/regex.js';

/** Valores que intentan cambiar el origen, la ruta o la consulta, o colar un destino interno. Los invisibles y los sustitutos van como escapes. */
const HOSTILE = [
  '..', '.', '%2e', '%2E', '.%2e', '/', '\\', '?', '#', '@', ':', '%', '%00', '\u0000', '\ud800', '\udc00', '\u200b', '\u00ad', '\ufeff', '\u2028', '\u0085', '\u00a0',
  '\uff41', '\uff0e', '\u3002', '\uff11\uff12\uff17', '127.0.0.1', 'localhost', 'x.localhost', 'a b', '\n', '\t', 'ñ', '\u{1F600}', 'xn--', '0x7f', '2130706433',
  '[::1]', '..%2f', ' ', '', 'a', '1', '80', 'evil.com', 'evil.com/', 'evil.com@', 'a.b', "'", '(', '*', '\u202e', '\ufe0f', '\u{e0100}',
];

function generator(seed: number) {
  const rand = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const value = (): string => Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(HOSTILE)).join('');
  return { pick, value };
}

interface Shape {
  template: string;
  /** Devuelve el motivo si la URL aceptada viola el invariante de esa plantilla, o `null`. */
  check: (url: URL) => string | null;
}

const API = 'api.example.com';
const SHAPES: Shape[] = [
  { template: `https://${API}/{{a}}/x?q={{b}}`, check: (u) => (u.hostname !== API ? 'host' : u.pathname.split('/').length !== 3 ? 'segmentos' : u.hash !== '' ? 'fragmento' : !u.search.startsWith('?q=') ? 'consulta' : u.port !== '' ? 'puerto' : null) },
  { template: `https://${API}:{{p}}/`, check: (u) => (u.hostname !== API ? 'host' : u.pathname !== '/' ? 'ruta' : null) },
  { template: 'https://{{s}}.example.com/', check: (u) => (!u.hostname.endsWith('.example.com') ? 'sufijo' : u.pathname !== '/' ? 'ruta' : null) },
  { template: `http{{s}}://${API}/`, check: (u) => (u.hostname !== API ? 'host' : null) },
  { template: `{{s}}://${API}/`, check: (u) => (u.hostname !== API ? 'host' : null) },
  { template: `https://${API}/{{a}}{{b}}`, check: (u) => (u.hostname !== API ? 'host' : u.pathname.split('/').length !== 2 ? 'segmentos' : null) },
  { template: `https://${API}?x={{a}}/{{b}}`, check: (u) => (u.hostname !== API ? 'host' : u.pathname !== '/' ? 'ruta' : null) },
  { template: `https://${API}/a?{{a}}`, check: (u) => (u.hostname !== API ? 'host' : u.pathname !== '/a' ? 'ruta' : null) },
  { template: 'https://api.{{a}}.example.com:{{p}}/{{b}}', check: (u) => (!u.hostname.startsWith('api.') || !u.hostname.endsWith('.example.com') ? 'host' : null) },
  { template: `https://${API}/v1/{{a}}?k={{b}}&t={{p}}`, check: (u) => (u.hostname !== API ? 'host' : u.pathname.split('/').length !== 3 ? 'segmentos' : null) },
  { template: `https://${API}/{{a}}/../x`, check: () => 'una plantilla con ../ literal nunca es válida' },
  { template: `https://${API}/{{a}}/./x`, check: () => 'una plantilla con ./ literal nunca es válida' },
];

describe('valores hostiles en cada parte de la plantilla: el origen no cambia', () => {
  it.each(SHAPES.map((s) => [s.template, s] as const))('%s', (_template, shape) => {
    const { pick, value } = generator(shape.template.length * 7919);
    let accepted = 0;
    for (let i = 0; i < 6000; i++) {
      const values: Record<string, VariableValue> = { a: value(), b: value(), p: value(), s: value() };
      // Pesa más los valores razonables para que haya URLs aceptadas que comprobar.
      if (i % 3 === 0) values.s = pick(['api', 'api.eu', 's', 'https', 'http']);
      if (i % 3 === 0) values.p = pick(['', '80', '8080', '443']);
      if (i % 4 === 0) values.a = pick(['x', 'users', 'a.b', '1', '..a']);
      const built = buildRequestUrl(shape.template, (name) => values[name]);
      if (!built.ok) continue;
      accepted++;
      const url = new URL(built.url);
      const label = `${JSON.stringify(values)} → ${built.url}`;
      expect(url.href, label).toBe(built.url);
      expect(url.username + url.password, label).toBe('');
      expect(['http:', 'https:'], label).toContain(url.protocol);
      const problem = shape.check(url);
      expect(problem, label).toBeNull();
    }
    if (!shape.template.includes('../') && !shape.template.includes('/./')) expect(accepted, 'el generador acepta algunas URL').toBeGreaterThan(50);
    else expect(accepted).toBe(0);
  });
});

describe('IP, localhost y esquemas con valores en la parte del host', () => {
  const via = (template: string, value: string) => buildRequestUrl(template, () => value);

  it.each([
    '127.0.0.1', '0.0.0.0', '0', '127.1', '0x7f.1', '0x7f000001', '0177.0.0.1', '2130706433', '3232235777', '169.254.169.254', '2852039166', '0xA9FEA9FE', '1.2.3', '1.2.3.4.5',
    '[::1]', '[::]', '[::ffff:127.0.0.1]', 'localhost', 'LOCALHOST', 'localhost.', 'a.localhost', 'a.b.LOCALHOST', 'a.localhost.', '\uff11\uff12\uff17.0.0.1', '127\u30020\u30020\u30021',
    '\u2460\u2461\u2466.0.0.1', '1.1.1.1.',
  ])('el host entero de una variable (%j) no puede ser una IP ni localhost', (host) => {
    expect(via('https://{{h}}/', host).ok).toBe(false);
    expect(via('http://{{h}}:8080/x', host).ok).toBe(false);
  });

  it('una variable que es el host completo sí vale si es un dominio público (el autor la dejó abierta)', () => {
    expect(via('https://{{h}}/x', 'evil.com')).toEqual({ ok: true, url: 'https://evil.com/x' });
    expect(via('https://{{h}}/x', '127.0.0.1.nip.io')).toEqual({ ok: true, url: 'https://127.0.0.1.nip.io/x' });
  });

  it('una etiqueta abierta nunca puede cerrar el host antes del sufijo del autor', () => {
    for (const label of ['evil.com/', 'evil.com?', 'evil.com#', 'evil.com@', 'evil.com:', 'evil.com\\', 'evil.com%2f', '%2e%2e', '[::1]', '.', '..', '-', 'a-', '-a']) {
      const built = via('https://{{s}}.example.com/', label);
      if (built.ok) expect(new URL(built.url).hostname.endsWith('.example.com'), label).toBe(true);
    }
    expect(via('https://{{s}}.example.com/', 'evil.com/').ok).toBe(false);
    expect(via('https://{{s}}.example.com/', 'a@b').ok).toBe(false);
    expect(via('https://{{s}}.example.com/', '').ok).toBe(false);
    expect(via('https://{{s}}.example.com/', 'a.').ok).toBe(false);
  });

  it('el esquema solo se completa con s; cualquier otra cosa no llega a http(s)', () => {
    expect(via('http{{s}}://api.example.com/', 's')).toEqual({ ok: true, url: 'https://api.example.com/' });
    expect(via('http{{s}}://api.example.com/', '')).toEqual({ ok: true, url: 'http://api.example.com/' });
    for (const s of ['S', 'x', 'ss', '://evil.com/#', ':', '\uff53', 's\u200b', '%73', '.']) expect(via('http{{s}}://api.example.com/', s).ok, JSON.stringify(s)).toBe(s === 'S');
    expect(via('{{s}}://api.example.com/', 'https')).toEqual({ ok: true, url: 'https://api.example.com/' });
    expect(via('{{s}}://api.example.com/', 'ftp').ok).toBe(false);
    expect(via('{{s}}://api.example.com/', 'https://evil.com/?').ok).toBe(false);
  });

  it('el puerto solo admite dígitos; un valor que parece otro host o credenciales no cambia el origen', () => {
    expect(via('https://api.example.com:{{p}}/', '8443')).toEqual({ ok: true, url: 'https://api.example.com:8443/' });
    expect(via('https://api.example.com:{{p}}/', '443')).toEqual({ ok: true, url: 'https://api.example.com/' });
    expect(via('https://api.example.com:{{p}}/', '')).toEqual({ ok: true, url: 'https://api.example.com/' });
    for (const p of ['80@evil.com', '80.evil.com', '0x50', '-1', '65536', '99999', '1e3', ' 80', '80\n', '\uff18\uff10', '@evil.com', '80/..', '80%2f']) {
      expect(via('https://api.example.com:{{p}}/', p).ok, JSON.stringify(p)).toBe(false);
    }
    expect(via('https://api.example.com:{{p}}@evil.com/', '80').ok).toBe(false);
    expect(via('https://{{u}}@api.example.com/', 'user').ok).toBe(false);
  });
});

describe('URL escrita por el autor: formas de IP, IDN y separadores', () => {
  const ok = (text: string) => validateUrlText(text);

  it.each([
    'http://0/', 'http://0.0.0.0/', 'http://[::ffff:127.0.0.1]/', 'http://127.1/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://1.1.1.1./', 'http://localhost./', 'http://LOCALHOST/',
    'http://a.LOCALHOST/', 'http://x.localhost./', 'http://\u2460\u2461\u2466.0.0.1/', 'http://127\u30020\u30020\u30021/', 'http://%31%32%37.0.0.1/', 'http://0x7f%2e0.0.1/', 'http://0300.0250.0.1/',
    'http://1.2.3/', 'http://2852039166/', 'http://[::]/', 'http://[0:0:0:0:0:ffff:7f00:1]/', 'http://[fd00::1]/', 'http://0xA9FEA9FE/', 'http://0251.0376.0251.0376/', 'http://169.254.169.254/',
    'https://api.example.com:65536/', 'http://a@b.com/', 'https://api.example.com\t/', 'https://API.EXAMPLE.COM./', 'https://a.b/', 'https://1.2.3.4.5/', 'https:api.example.com', 'http:\\\\api.example.com',
    'http:/\\api.example.com', 'https://api.example.com\uff0fx', 'https://api.example.com\uff1a80/', 'https://api.example.com\u2025/', 'https://api.example.com/\u202e', 'https://api.example.com/\u00ad',
    'https://api.example.com/\u2028', 'https://api.example.com/#', 'https://api.example.com/?#', 'https://exa mple.com/', 'https://api.example.com/\ud800', 'https://api.example.com/a\udc00',
  ])('%j es inválida', (text) => {
    expect(ok(text)).toBeUndefined();
  });

  it.each([
    ['https://api.example.com:0/', 'https://api.example.com:0/'],
    ['https://api.example.com:00080/', 'https://api.example.com:80/'],
    ['https://:@api.example.com/', 'https://api.example.com/'],
    ['https://@api.example.com/', 'https://api.example.com/'],
    ['https:///api.example.com/', 'https://api.example.com/'],
    ['https:////api.example.com/', 'https://api.example.com/'],
    ['HTTP://API.example.com', 'http://api.example.com/'],
    ['https://éxample.com/', 'https://xn--xample-9ua.com/'],
    ['https://EXAMPLE\u3002com/', 'https://example.com/'],
    ['https://\uff41pi.example.com/', 'https://api.example.com/'],
    ['http://127.0.0.1.nip.io/', 'http://127.0.0.1.nip.io/'],
    ['https://1.2.3.4a/', 'https://1.2.3.4a/'],
    ['https://api.example.com/\u0085', 'https://api.example.com/%C2%85'],
    ['https://api.example.com/a/..;/b', 'https://api.example.com/a/..;/b'],
    ['https://api.example.com/a/..%2fb', 'https://api.example.com/a/..%2fb'],
    ['https://api.example.com//x', 'https://api.example.com//x'],
    ['https://api.example.com/%', 'https://api.example.com/%'],
    ['https://api.example.com/%ZZ', 'https://api.example.com/%ZZ'],
    ['https://api.example.com?', 'https://api.example.com/?'],
  ])('%j se acepta como %j', (text, href) => {
    expect(ok(text)).toBe(href);
  });

  it('un puerto o un usuario vacíos no cambian el origen; credenciales sin usuario pero con contraseña sí se rechazan', () => {
    expect(ok('https://:p@api.example.com/')).toBeUndefined();
    expect(ok('https://:@api.example.com/')).toBe('https://api.example.com/');
    expect(ok('https://u:@api.example.com/')).toBeUndefined();
    expect(ok('https://u@api.example.com/')).toBeUndefined();
  });

  it('segmentos de punto, con %2e en cualquier combinación y en cualquier posición de la ruta', () => {
    for (const segment of ['..', '.', '%2e', '%2E', '.%2e', '%2e.', '%2E%2e', '%2e%2E', '.%2E']) {
      for (const path of [`/${segment}`, `/${segment}/`, `/a/${segment}`, `/a/${segment}/b`, `//${segment}`, `/a//${segment}`]) {
        expect(ok(`https://api.example.com${path}`), path).toBeUndefined();
        expect(ok(`https://api.example.com${path}?k=1`), path).toBeUndefined();
      }
    }
    for (const segment of ['...', '..a', 'a..', '.a', '%2e%2e%2e', '%252e', '%2', '%2g', '..%00', '.%2f.']) {
      expect(ok(`https://api.example.com/u/${segment}/x`), segment).toBeDefined();
    }
  });
});

describe('Longitud de la URL: antes y después de serializar', () => {
  const origin = 'https://api.example.com/';
  // buildRequestUrl con una plantilla sin marcadores: aplica el límite de antes de serializar (renderTemplate) y el de después.
  const build = (text: string) => {
    const built = buildRequestUrl(text, () => undefined);
    return built.ok ? built.url : undefined;
  };

  it('8192 unidades se aceptan y 8193 no, con y sin conversión del puerto o de las mayúsculas', () => {
    expect(build(origin + 'a'.repeat(8192 - origin.length))).toHaveLength(8192);
    expect(build(origin + 'a'.repeat(8193 - origin.length))).toBeUndefined();
    const withPort = 'https://api.example.com:443/';
    expect(build(withPort + 'a'.repeat(8192 - withPort.length))).toHaveLength(8188);
    expect(build(withPort + 'a'.repeat(8193 - withPort.length))).toBeUndefined();
    const upper = 'HTTPS://API.EXAMPLE.COM/';
    expect(build(upper + 'a'.repeat(8192 - upper.length))).toHaveLength(8192);
  });

  it('un valor de 907 caracteres chinos cabe y de 908 no; el presupuesto cuenta lo codificado', () => {
    const lookup = (v: string) => (name: string): VariableValue | undefined => (name === 'v' ? v : undefined);
    const template = 'https://api.example.com/?q={{v}}';
    expect(buildRequestUrl(template, lookup('\u4e2d'.repeat(907)))).toMatchObject({ ok: true });
    expect(buildRequestUrl(template, lookup('\u4e2d'.repeat(908)))).toEqual({ ok: false });
    expect(buildRequestUrl(template, lookup('a'.repeat(8192 - 'https://api.example.com/?q='.length)))).toMatchObject({ ok: true });
    expect(buildRequestUrl(template, lookup('a'.repeat(8193 - 'https://api.example.com/?q='.length)))).toEqual({ ok: false });
    expect(buildRequestUrl(template, lookup('ñ'.repeat(1360)))).toMatchObject({ ok: true }); // 27 + 6 × 1360 = 8187
    expect(buildRequestUrl(template, lookup('ñ'.repeat(1361)))).toEqual({ ok: false }); // 8193
  });

  it('un valor enorme se rechaza sin recorrerlo entero (el presupuesto lo corta)', () => {
    const t0 = performance.now();
    expect(buildRequestUrl('https://api.example.com/{{v}}', () => 'x'.repeat(2 ** 26))).toEqual({ ok: false });
    expect(buildRequestUrl('https://api.example.com/{{v}}', () => `${'x'.repeat(2 ** 26)}\ud800`)).toEqual({ ok: false });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('Una consulta pegada al host que contiene /../ no es una ruta', () => {
  // Corregido: hasDotSegment termina la ruta en el primer «?» desde la autoridad (una «/» de la consulta no abre una ruta).
  it('https://api.example.com?x=/../y es válida (la ruta está vacía)', () => {
    expect(validateUrlText('https://api.example.com?x=/../y')).toBe('https://api.example.com/?x=/../y');
  });

  it('https://api.example.com?x=/./y es válida', () => {
    expect(validateUrlText('https://api.example.com?x=/./y')).toBe('https://api.example.com/?x=/./y');
  });

  it('con una ruta explícita la misma consulta sí se acepta', () => {
    expect(validateUrlText('https://api.example.com/a?x=/../y')).toBe('https://api.example.com/a?x=/../y');
  });
});
