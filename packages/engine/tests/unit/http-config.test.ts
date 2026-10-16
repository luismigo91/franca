import { describe, expect, it } from 'vitest';
import { checkHttpConfig } from '../../src/http/config.js';
import { node } from '../helpers/http-node.js';

const withHeaders = (headers: Record<string, unknown>, extra = {}) => node({ headers }, extra);
const TCHARS = "!#$%&'*+-.^_`|~";

describe('nombres de cabecera: tokens', () => {
  it.each([...TCHARS])('el tchar %j se admite', (c) => {
    expect(checkHttpConfig(withHeaders({ [`X${c}Y`]: 'v' }))).toBeNull();
    expect(checkHttpConfig(withHeaders({ [c]: 'v' }))).toBeNull();
  });

  it('letras y dígitos ASCII se admiten', () => {
    expect(checkHttpConfig(withHeaders({ 'X-Request-Id9': 'v', abcXYZ019: 'v' }))).toBeNull();
  });

  it.each([' ', '\t', '"', '(', ')', ',', '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '{', '}'])(
    'el separador %j se rechaza',
    (c) => expect(checkHttpConfig(withHeaders({ [`X${c}Y`]: 'v' }))).not.toBeNull(),
  );

  it.each(['X-Ñ', 'É', 'XK', 'Xı', '\u{1F600}', 'X\u200bY', 'X\u00a0Y', 'X\u0000Y', 'X\nY', 'X\u007fY'])(
    'el nombre no ASCII o con controles %j se rechaza',
    (name) => expect(checkHttpConfig(withHeaders({ [name]: 'v' }))).not.toBeNull(),
  );

  it('el nombre vacío se rechaza', () => {
    expect(checkHttpConfig(withHeaders({ '': 'v' }))).not.toBeNull();
  });

  it('la K de Kelvin (U+212A) no se pliega a una k reservada', () => {
    // `Keep-Alive` con K de Kelvin no es un token: se rechaza por token, no por reservado, y no hay plegado Unicode
    expect(checkHttpConfig(withHeaders({ 'Keep-Alive': 'v' }))).toBe('el nombre de una cabecera no es un token válido');
  });
});

describe('número de cabeceras y duplicados', () => {
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`X-H${i + 1}`, 'v']));

  it('32 se admiten y 33 se rechazan', () => {
    expect(checkHttpConfig(withHeaders(many(32)))).toBeNull();
    expect(checkHttpConfig(withHeaders(many(33)))).not.toBeNull();
  });

  it('el límite se comprueba antes que los nombres', () => {
    expect(checkHttpConfig(withHeaders({ ...many(33), 'bad name': 'v' }))).toContain('más de 32');
  });

  it.each([
    ['Content-Type', 'content-type'],
    ['X-A', 'x-a'],
    ['ACCEPT', 'Accept'],
    ['Accept', 'ACCEPT'],
  ])('%j y %j son el mismo nombre', (a, b) => {
    expect(checkHttpConfig(withHeaders({ [a]: 'v', [b]: 'w' }))).toBe('dos cabeceras tienen el mismo nombre');
  });

  it('nombres distintos no son duplicados', () => {
    expect(checkHttpConfig(withHeaders({ 'X-A': 'v', 'X-B': 'v' }))).toBeNull();
  });
});

describe('cabeceras reservadas', () => {
  const RESERVED = ['Host', 'Content-Length', 'Transfer-Encoding', 'Connection', 'Keep-Alive', 'Upgrade', 'TE', 'Trailer', 'Expect'];

  it.each(RESERVED)('%s se rechaza con cualquier capitalización', (name) => {
    for (const variant of [name, name.toUpperCase(), name.toLowerCase()]) {
      expect(checkHttpConfig(withHeaders({ [variant]: 'v' })), variant).toBe('una cabecera está reservada al host');
    }
  });

  it.each(['Proxy-Authorization', 'proxy-connection', 'PROXY-X', 'Proxy-'])('%s (prefijo Proxy-) se rechaza', (name) => {
    expect(checkHttpConfig(withHeaders({ [name]: 'v' }))).toBe('una cabecera está reservada al host');
  });

  it('un nombre que solo contiene una reservada no lo es', () => {
    expect(checkHttpConfig(withHeaders({ 'X-Host': 'v', Hostname: 'v', 'X-Proxy-A': 'v', Proxy: 'v', Tex: 'v' }))).toBeNull();
  });

  it('también un secreto con nombre reservado', () => {
    expect(checkHttpConfig(withHeaders({ Host: { secret: 'S' } }))).not.toBeNull();
  });

  it('admitidas: Accept, X-Request-Id, Authorization y Cookie', () => {
    expect(
      checkHttpConfig(withHeaders({ Accept: 'application/json', 'X-Request-Id': 'r-1', Authorization: { secret: 'CRM_TOKEN' }, Cookie: 'a=b' })),
    ).toBeNull();
  });
});

describe('body y método', () => {
  const body = (method: string, value: unknown) => node({ method, ...(value === undefined ? {} : { body: value }) });

  it.each([{}, [], 0, '', false, { a: 1 }, 'x'])('GET con body %j se rechaza', (value) => {
    expect(checkHttpConfig(body('GET', value))).toBe('una petición GET no puede llevar body');
  });

  it('GET sin body y con body null se admiten', () => {
    expect(checkHttpConfig(body('GET', undefined))).toBeNull();
    expect(checkHttpConfig(body('GET', null))).toBeNull();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s con body se admite', (method) => {
    expect(checkHttpConfig(body(method, { a: 1 }))).toBeNull();
  });
});

describe('punteros de responseMap', () => {
  const pointers = (...values: string[]) => node({}, { responseMap: values.map((pointer) => ({ variable: 'v', pointer })) });

  it.each(['/a~2', '/a~', '~', '/~', '/a~x/b', '/ok/~'])('%j se rechaza', (pointer) => {
    expect(checkHttpConfig(pointers(pointer))).toBe('un puntero de responseMap tiene un escape ~ inválido');
  });

  it.each(['', '/', '/a', '/a~0b', '/a~1b', '/~01', '/~10', '/a/b/0'])('%j se admite', (pointer) => {
    expect(checkHttpConfig(pointers(pointer))).toBeNull();
  });

  it('basta con uno malo entre varios', () => {
    expect(checkHttpConfig(pointers('/a', '/b~9', '/c'))).not.toBeNull();
  });
});

describe('mensajes', () => {
  it('no nombran la cabecera ni el puntero', () => {
    const secretName = 'X-Nombre-Secreto Con Espacio';
    expect(checkHttpConfig(withHeaders({ [secretName]: 'v' }))).not.toContain('Secreto');
    expect(checkHttpConfig(node({}, { responseMap: [{ variable: 'v', pointer: '/campo-secreto~9' }] }))).not.toContain('secreto');
  });
});
