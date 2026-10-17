import type { Server } from 'node:http';
import request, { type Test } from 'supertest';

type Body = object | string | undefined;

function withBody(test: Test, body: Body): Test {
  if (body === undefined) return test;
  return test.set('Content-Type', 'application/json').send(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * Cliente de los e2e sobre `supertest`. Un cuerpo `string` se envía tal cual (texto crudo: `1e400`, `__proto__`,
 * el orden de las claves); un objeto, con `JSON.stringify`. Siempre `Content-Type: application/json` si hay cuerpo.
 */
export function client(server: Server) {
  const ifMatch = (test: Test, value: string | undefined) => (value === undefined ? test : test.set('If-Match', value));
  return {
    validate: (body: Body) => withBody(request(server).post('/flows/validate'), body),
    create: (body: Body) => withBody(request(server).post('/flows'), body),
    get: (id: string) => request(server).get(`/flows/${id}`),
    list: (query = '') => request(server).get(`/flows${query}`),
    update: (id: string, body: Body, match?: string) => ifMatch(withBody(request(server).put(`/flows/${id}`), body), match),
    remove: (id: string, match?: string) => ifMatch(request(server).delete(`/flows/${id}`), match),
    publish: (id: string, match?: string) => ifMatch(request(server).post(`/flows/${id}/versions`), match),
    versions: (id: string, query = '') => request(server).get(`/flows/${id}/versions${query}`),
    version: (id: string, version: string | number) => request(server).get(`/flows/${id}/versions/${version}`),
  };
}

export type ApiClient = ReturnType<typeof client>;
