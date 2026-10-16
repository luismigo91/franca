import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateFlow, type FlowIssue } from '../src/index.js';
import { renderTypes, TYPES_PATH } from '../scripts/types.mjs';

const read = (path: string): any => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const leads = () => read('../examples/captacion-leads.json');
const faq = () => read('../examples/faq-ia.json');

function issues(flow: unknown): Omit<FlowIssue, 'layer'>[] {
  const result = validateFlow(flow);
  return result.issues.map(({ layer: _, ...rest }) => rest);
}

function messages(flow: unknown): string[] {
  return validateFlow(flow).issues.map((i) => `${i.layer} ${i.path} ${i.message}`);
}

describe('ejemplos', () => {
  const files = readdirSync(new URL('../examples/', import.meta.url)).filter((f) => f.endsWith('.json'));

  it.each(files)('%s es válido', (file) => {
    const result = validateFlow(read(`../examples/${file}`));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('flujos rotos de tests/invalid', () => {
  it('roto-forma: propiedad desconocida y campo obligatorio ausente', () => {
    expect(validateFlow(read('./invalid/roto-forma.json')).issues).toEqual([
      { layer: 'shape', path: '/nodes/0', nodeId: 'saludo', message: "propiedad no permitida 'color'" },
      {
        layer: 'shape',
        path: '/nodes/1',
        nodeId: 'asistente',
        message: "falta la propiedad obligatoria 'onExhausted'",
      },
    ]);
  });

  it('roto-semantica: variable no declarada, salto roto e inalcanzables', () => {
    const result = issues(read('./invalid/roto-semantica.json'));
    expect(result).toContainEqual({ path: '/nodes/0', nodeId: 'bienvenida', message: 'variable no declarada: ciudad' });
    expect(result).toContainEqual({
      path: '/nodes/1/next',
      nodeId: 'pedir-nombre',
      message: 'next apunta a un nodo inexistente: no-existe',
    });
    expect(result).toContainEqual({ path: '/nodes/2', nodeId: 'pedir-email', message: 'nodo inalcanzable desde start' });
    expect(result).toContainEqual({ path: '/nodes', message: 'ningún nodo end es alcanzable' });
    expect(result).toHaveLength(12);
  });
});

describe('forma', () => {
  it('rechaza lo que no es un objeto', () => {
    expect(messages(null)).toEqual(['shape  debe ser de tipo object']);
  });

  it('exige specVersion 0.1', () => {
    expect(messages({ ...leads(), specVersion: '1.0' })).toEqual(['shape /specVersion debe ser "0.1"']);
  });

  it('rechaza propiedades desconocidas en la raíz', () => {
    expect(messages({ ...leads(), autor: 'yo' })).toEqual(["shape  propiedad no permitida 'autor'"]);
  });

  it('informa del tipo de nodo desconocido', () => {
    const flow = leads();
    flow.nodes[0].type = 'video';
    expect(issues(flow)).toEqual([
      { path: '/nodes/0', nodeId: 'bienvenida', message: 'tipo de nodo desconocido: "video"' },
    ]);
  });

  it('da errores solo del tipo del nodo, no de las otras ramas', () => {
    const flow = leads();
    flow.nodes[6].timeoutMs = 50;
    expect(issues(flow)).toEqual([{ path: '/nodes/6/timeoutMs', nodeId: 'enviar-crm', message: 'debe ser >= 100' }]);
  });

  it('no admite choices si inputType no es choice', () => {
    const flow = leads();
    flow.nodes[1].choices = [{ id: 'a', label: 'A', next: 'pedir-email' }];
    expect(issues(flow)).toEqual([
      { path: '/nodes/1', nodeId: 'pedir-nombre', message: "'choices' solo se permite con inputType \"choice\"" },
    ]);
  });

  it('exige choices si inputType es choice', () => {
    const flow = leads();
    delete flow.nodes[3].choices;
    expect(issues(flow)).toEqual([
      { path: '/nodes/3', nodeId: 'pedir-tamano', message: "falta la propiedad obligatoria 'choices'" },
    ]);
  });

  it('resume en un error un contenido que no encaja en ninguna forma', () => {
    const flow = leads();
    flow.nodes[0].content = [{ kind: 'text' }];
    expect(issues(flow)).toEqual([
      { path: '/nodes/0/content/0', nodeId: 'bienvenida', message: 'no coincide con ninguna de las formas permitidas' },
    ]);
  });
});

describe('semántica', () => {
  it('detecta ids de nodo duplicados', () => {
    const flow = leads();
    flow.nodes[10].id = 'fin-pyme';
    expect(messages(flow)).toContain('semantic /nodes/10/id id de nodo duplicado: fin-pyme');
  });

  it('detecta un start que no existe', () => {
    expect(messages({ ...leads(), start: 'nadie' })).toContain('semantic /start start apunta a un nodo inexistente: nadie');
  });

  it('detecta un nodo que salta a sí mismo', () => {
    const flow = leads();
    flow.nodes[0].next = 'bienvenida';
    expect(messages(flow)).toContain('semantic /nodes/0/next next apunta a sí mismo');
  });

  it('permite que un nodo llm salte a sí mismo', () => {
    const flow = faq();
    flow.nodes[1].next = 'asistente';
    expect(messages(flow)).not.toContainEqual(expect.stringContaining('apunta a sí mismo'));
  });

  it('detecta saltos rotos en reglas y opciones', () => {
    const flow = leads();
    flow.nodes[7].rules[0].next = 'fantasma';
    flow.nodes[3].choices[2].next = 'otro-fantasma';
    const result = messages(flow);
    expect(result).toContain('semantic /nodes/7/rules/0/next rules[0].next apunta a un nodo inexistente: fantasma');
    expect(result).toContain(
      'semantic /nodes/3/choices/2/next choices[grande].next apunta a un nodo inexistente: otro-fantasma',
    );
  });

  it('exige next en cada opción de una selección única', () => {
    const flow = leads();
    delete flow.nodes[3].choices[0].next;
    expect(messages(flow)).toEqual(['semantic /nodes/3/choices en selección única, cada opción necesita next']);
  });

  it('no exige next por opción en selección múltiple', () => {
    const flow = leads();
    Object.assign(flow.nodes[3], { multiple: true, next: 'marcar-pyme' });
    for (const c of flow.nodes[3].choices) delete c.next;
    expect(messages(flow)).toEqual(['semantic /nodes/5 nodo inalcanzable desde start']);
  });

  it('exige next en el nodo de una selección múltiple', () => {
    const flow = leads();
    flow.nodes[3].multiple = true;
    expect(messages(flow)).toEqual(['semantic /nodes/3 en selección múltiple, el nodo necesita next']);
  });

  it('acepta una selección múltiple con next en el nodo', () => {
    const flow = leads();
    Object.assign(flow.nodes[3], { multiple: true, next: 'marcar-pyme' });
    expect(messages(flow)).toEqual([]);
  });

  it('detecta ids de opción duplicados', () => {
    const flow = leads();
    flow.nodes[3].choices[1].id = 'pequena';
    expect(messages(flow)).toEqual(['semantic /nodes/3/choices ids de opción duplicados']);
  });

  it('detecta variables no declaradas en asignaciones, condiciones y respuestas HTTP', () => {
    const flow = leads();
    flow.nodes[4].assignments[0].variable = 'sin_declarar_set';
    flow.nodes[7].rules[0].when = { any: [{ variable: 'sin_declarar_cond', op: 'isSet' }] };
    flow.nodes[6].responseMap = [{ variable: 'sin_declarar_http', pointer: '/id' }];
    const result = messages(flow);
    expect(result).toContain('semantic /nodes/4 variable no declarada: sin_declarar_set');
    expect(result).toContain('semantic /nodes/7 variable no declarada: sin_declarar_cond');
    expect(result).toContain('semantic /nodes/6 variable no declarada: sin_declarar_http');
  });

  it('detecta variables no declaradas en slots de llm', () => {
    const flow = faq();
    flow.nodes[1].slots.push({ variable: 'telefono', description: 'teléfono de contacto' });
    expect(messages(flow)).toEqual(['semantic /nodes/1 variable no declarada: telefono']);
  });
});

describe('tipos', () => {
  it('src/types.ts está al día con flow.schema.json (si falla: pnpm generate)', async () => {
    expect(readFileSync(TYPES_PATH, 'utf8')).toBe(await renderTypes());
  });
});
