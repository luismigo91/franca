import { describe, expect, it } from 'vitest';
import { capWarnings, FLOW_WARNING_CODES, validateFlow, type FlowWarning } from '../src/index.js';
import { faq, leads } from './helpers/flows.js';

const HTTP = 6;
const URL_PATH = '/nodes/6/request/url';
const AUTH_PATH = '/nodes/6/request/headers/Authorization';
const URL_MESSAGE =
  'el origen de la url (esquema, host o puerto) depende de una variable: un valor puede cambiar el destino de la petición';
const SECRET_HINT = 'las credenciales van como referencia a un secreto ({"secret": "NOMBRE"})';

/** `captacion-leads` con la `url` de `enviar-crm` cambiada. */
function withUrl(url: string): any {
  const flow = leads();
  flow.nodes[HTTP].request.url = url;
  return flow;
}

/** `captacion-leads` con las cabeceras de `enviar-crm` sustituidas. */
function withHeaders(headers: Record<string, unknown>): any {
  const flow = leads();
  flow.nodes[HTTP].request.headers = headers;
  return flow;
}

const urlWarning: FlowWarning = {
  code: 'url_template_in_origin',
  path: URL_PATH,
  nodeId: 'enviar-crm',
  message: URL_MESSAGE,
};

describe('Avisos del validador', () => {
  it('Flujo válido con un aviso', () => {
    const result = validateFlow(withUrl('https://{{segmento}}.crm.example.com/api/leads'));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.code).toBe('url_template_in_origin');
  });

  it('Flujo sin avisos', () => {
    for (const flow of [leads(), faq()]) {
      const result = validateFlow(flow);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('Error semántico y aviso a la vez', () => {
    const flow = withHeaders({ Authorization: 'Bearer abc123', 'Content-Type': 'application/json' });
    flow.start = 'no-existe';
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      layer: 'semantic',
      path: '/start',
      message: 'start apunta a un nodo inexistente: no-existe',
    });
    expect(result.warnings.map((w) => w.code)).toEqual(['credential_header_literal']);
  });

  it('Error de forma sin avisos', () => {
    const flow = withHeaders({ Authorization: 'Bearer abc123' });
    flow.nodes[0].color = 'rojo';
    const result = validateFlow(flow);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      { layer: 'shape', path: '/nodes/0', nodeId: 'bienvenida', message: "propiedad no permitida 'color'" },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('Códigos y forma de los avisos', () => {
  it('Lista de códigos', () => {
    expect(FLOW_WARNING_CODES).toEqual([
      'url_template_in_origin',
      'credential_header_not_secret',
      'credential_header_literal',
      'too_many_warnings',
    ]);
  });

  it('El mensaje no contiene el valor de una cabecera', () => {
    const result = validateFlow(withHeaders({ Authorization: 'Bearer abc123' }));
    expect(result.warnings).toHaveLength(1);
    for (const warning of result.warnings) {
      expect(warning.message).not.toContain('abc123');
      expect(warning.message).not.toContain('Bearer');
    }
  });
});

describe('Orden de los avisos', () => {
  it('Varios avisos ordenados', () => {
    const flow = withUrl('https://crm.example.com:{{segmento}}/api/leads');
    flow.nodes[HTTP].request.headers.Authorization = 'Bearer abc123';
    const { warnings } = validateFlow(flow);
    expect(warnings.map((w) => w.path)).toEqual([AUTH_PATH, URL_PATH]);
  });

  it('Un aviso por url aunque tenga varios marcadores', () => {
    const { warnings } = validateFlow(withUrl('http{{segmento}}://{{segmento}}.example.com:{{segmento}}/x'));
    expect(warnings).toEqual([urlWarning]);
  });
});

describe('Marcador en el origen de la url', () => {
  it('Marcador en el esquema, en el host, pegado al host y en el puerto', () => {
    const urls = [
      'http{{segmento}}://crm.example.com/api/leads',
      'https://{{segmento}}.crm.example.com/api/leads',
      'https://crm.example.com{{segmento}}/api/leads',
      'https://crm.example.com:{{segmento}}/api/leads',
      'https://{{ segmento }}.example.com/',
    ];
    for (const url of urls) {
      const result = validateFlow(withUrl(url));
      expect(result.valid, url).toBe(true);
      expect(result.warnings, url).toEqual([urlWarning]);
    }
  });

  it('La url entera sale de una variable', () => {
    const { warnings } = validateFlow(withUrl('{{segmento}}/api/leads'));
    expect(warnings.map((w) => w.code)).toEqual(['url_template_in_origin']);
  });

  it('Marcadores fuera del origen', () => {
    const urls = [
      'https://crm.example.com/api/{{segmento}}',
      'https://crm.example.com?s={{segmento}}',
      'https://crm.example.com/api/leads?s={{segmento}}#{{segmento}}',
    ];
    for (const url of urls) expect(validateFlow(withUrl(url)).warnings, url).toEqual([]);
  });

  it('Llaves que no son un marcador', () => {
    expect(validateFlow(withUrl('https://crm{{1x}}.example.com/api/leads')).warnings).toEqual([]);
  });
});

describe('Cabecera de credenciales con texto', () => {
  it('Token pegado en Authorization', () => {
    const result = validateFlow(withHeaders({ Authorization: 'Bearer abc123', 'Content-Type': 'application/json' }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'credential_header_literal',
        path: AUTH_PATH,
        nodeId: 'enviar-crm',
        message: `la cabecera Authorization lleva el valor escrito en el flujo: ${SECRET_HINT}`,
      },
    ]);
  });

  it('Credencial a partir de una variable y nombre en minúsculas', () => {
    const result = validateFlow(withHeaders({ 'x-api-key': '{{segmento}}', 'Content-Type': 'application/json' }));
    expect(result.warnings).toEqual([
      {
        code: 'credential_header_not_secret',
        path: '/nodes/6/request/headers/x-api-key',
        nodeId: 'enviar-crm',
        message: `la cabecera x-api-key se construye con variables: ${SECRET_HINT}`,
      },
    ]);
  });

  it('Marcador dentro de un texto con prefijo', () => {
    const { warnings } = validateFlow(withHeaders({ Authorization: 'Bearer {{segmento}}' }));
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['credential_header_not_secret', AUTH_PATH]]);
  });

  it('Texto vacío y llaves que no son un marcador', () => {
    const empty = validateFlow(withHeaders({ 'Proxy-Authorization': '' }));
    expect(empty.warnings.map((w) => [w.code, w.path])).toEqual([
      ['credential_header_literal', '/nodes/6/request/headers/Proxy-Authorization'],
    ]);
    const braces = validateFlow(withHeaders({ Authorization: 'Bearer {{1x}}' }));
    expect(braces.warnings.map((w) => [w.code, w.path])).toEqual([['credential_header_literal', AUTH_PATH]]);
  });

  it('Referencias a secreto y otras cabeceras', () => {
    for (const flow of [leads(), faq()]) {
      const codes = validateFlow(flow).warnings.map((w) => w.code);
      expect(codes).not.toContain('credential_header_not_secret');
      expect(codes).not.toContain('credential_header_literal');
    }
  });
});

describe('Recorte de avisos para mostrar', () => {
  const warning = (i: number): FlowWarning => ({ code: 'url_template_in_origin', path: `/nodes/${i}/request/url`, message: URL_MESSAGE });

  it('Recortar 150 avisos', () => {
    const all = Array.from({ length: 150 }, (_, i) => warning(i));
    const capped = capWarnings(all);
    expect(capped).toHaveLength(101);
    expect(capped.slice(0, 100)).toEqual(all.slice(0, 100));
    expect(capped[100]).toEqual({
      code: 'too_many_warnings',
      path: '',
      message: 'hay más avisos: solo se muestran los 100 primeros',
    });
  });

  it('Sin recorte', () => {
    const all = Array.from({ length: 100 }, (_, i) => warning(i));
    expect(capWarnings(all)).toBe(all);
  });
});
