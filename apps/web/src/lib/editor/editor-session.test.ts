import { describe, expect, it, vi } from 'vitest';
import { FLOWS } from '../../../tests/helpers/engine-events';
import type { ChatErrorCode } from '@/lib/chat/copy';
import type { FlowResource, VersionResource } from '@/lib/editor/api-types';
import { EDITOR_COPY } from '@/lib/editor/copy';
import { EditorSession, type SessionClient } from '@/lib/editor/editor-session';
import { writeText, writeTarget } from '@/lib/editor/fields';
import { flowText } from '@/lib/editor/flow-text';
import type { Change, FlowDoc } from '@/lib/editor/json-edit';
import { connectOutput, replaceNodeJson } from '@/lib/editor/node-ops';
import { checkTryable } from '@/lib/editor/save-gate';
import type { ClientResult } from '@/lib/web-client';

const clone = (name: keyof typeof FLOWS): FlowDoc => structuredClone(FLOWS[name]) as FlowDoc;
const resource = (flow: FlowDoc, extra: Partial<FlowResource> = {}): FlowResource => ({
  id: String(flow.id),
  name: String(flow.name),
  revision: 1,
  latestVersion: null,
  unpublishedChanges: true,
  flow,
  ...extra,
});
const ok = <T>(body: T, status = 200): ClientResult<T> => ({ ok: true, status, body });
const fail = (status: number | null, code: ChatErrorCode, currentRevision?: number): ClientResult<never> =>
  currentRevision === undefined ? { ok: false, status, code } : { ok: false, status, code, currentRevision };

type Scripted<T> = ClientResult<T> | (() => Promise<ClientResult<T>>);

/** Un cliente falso con guion y registro de llamadas. */
class FakeClient implements SessionClient {
  calls: string[] = [];
  gets: Scripted<FlowResource>[] = [];
  puts: Scripted<FlowResource>[] = [];
  publishes: Scripted<VersionResource>[] = [];
  deletes: Scripted<null>[] = [];
  lastPut: { text: string; revision: number } | null = null;

  private async take<T>(queue: Scripted<T>[], name: string): Promise<ClientResult<T>> {
    this.calls.push(name);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    if (next === undefined) throw new Error(`sin guion para ${name}`);
    return typeof next === 'function' ? next() : next;
  }

  getFlow = () => this.take(this.gets, 'get');
  updateFlow = (_flowId: string, text: string, revision: number) => {
    this.lastPut = { text, revision };
    return this.take(this.puts, 'put');
  };
  publishFlow = () => this.take(this.publishes, 'publish');
  deleteFlow = () => this.take(this.deletes, 'delete');
  count = (name: string) => this.calls.filter((call) => call === name).length;
}

async function opened(flow: FlowDoc = clone('captacion-leads'), extra: Partial<FlowResource> = {}) {
  const client = new FakeClient();
  client.gets = [ok(resource(flow, extra))];
  const session = new EditorSession(String(flow.id), client);
  await session.open();
  return { client, session };
}

const renameTo = (name: string): Change => writeText('/name', name, true);

describe('open', () => {
  it('ready con el flujo, sin escribir las posiciones del diseño automático', async () => {
    const { session } = await opened(clone('faq-ia'));
    const snapshot = session.getSnapshot();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.draftText).toBe(snapshot.saved!.text);
    expect(snapshot.draftText).not.toContain('position');
    expect(snapshot.positions.size).toBe(7);
    expect(snapshot.verdict?.valid).toBe(true);
  });

  it('not_found con 404 y load_error con el resto', async () => {
    const client = new FakeClient();
    client.gets = [fail(404, 'flow_not_found')];
    const session = new EditorSession('nada', client);
    await session.open();
    expect(session.getSnapshot().phase).toBe('not_found');
    client.gets = [fail(502, 'api_unreachable')];
    await session.open();
    expect(session.getSnapshot()).toMatchObject({ phase: 'load_error', loadError: 'api_unreachable' });
    client.gets = [fail(null, 'network_error')];
    await session.open();
    expect(session.getSnapshot()).toMatchObject({ phase: 'load_error', loadError: 'network_error' });
  });

  it('vuelve a leer al abrir otra vez y descarta lo anterior', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Otro'));
    expect(session.getSnapshot().dirty).toBe(true);
    await session.open();
    expect(session.getSnapshot().dirty).toBe(false);
    expect(client.count('get')).toBe(2);
  });
});

describe('edit', () => {
  // `dirty` compara el texto, también tras deshacer a mano.
  it('Cambio deshecho a mano', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Otro'));
    expect(session.getSnapshot().dirty).toBe(true);
    session.edit(renameTo('Captación de leads'));
    expect(session.getSnapshot().dirty).toBe(false);
    const outcome = await session.save();
    expect(outcome).toEqual({ status: 'blocked', reason: 'unchanged' });
    expect(session.getSnapshot().notice?.text).toBe('No hay cambios que guardar.');
    expect(client.count('put')).toBe(0);
  });

  it('el veredicto se recalcula en cada cambio y no llama a la API', async () => {
    const { session, client } = await opened();
    session.edit(writeTarget('/nodes/1/next', null));
    expect(session.getSnapshot().verdict?.valid).toBe(false);
    expect(client.calls).toEqual(['get']);
  });

  it('un error de campo no cambia nada', async () => {
    const { session } = await opened();
    const before = session.getSnapshot();
    const result = session.edit(() => ({ ok: false, error: 'no' }));
    expect(result).toEqual({ ok: false, error: 'no' });
    expect(session.getSnapshot()).toBe(before);
  });

  // El error y el borrador idéntico.
  it('JSON de un nodo roto', async () => {
    const { session, client } = await opened();
    const before = session.getSnapshot().draftText;
    const result = session.edit((draft) => replaceNodeJson(draft, 'bienvenida', '{"id":'));
    expect(result.ok).toBe(false);
    expect(session.getSnapshot().draftText).toBe(before);
    expect(client.calls).toEqual(['get']);
  });

  it('una selección que ya no existe se quita', async () => {
    const { session } = await opened();
    session.select({ kind: 'node', id: 'bienvenida' });
    session.edit((draft) => ({ ok: true, flow: { ...draft, nodes: (draft.nodes as { id: string }[]).filter((node) => node.id !== 'bienvenida') } }));
    expect(session.getSnapshot().selection).toBeNull();
  });

  it('antes de abrir no edita', () => {
    const session = new EditorSession('x', new FakeClient());
    expect(session.edit(renameTo('a')).ok).toBe(false);
  });

  it('conectar fija las posiciones y no toca el último guardado', async () => {
    const { session } = await opened(clone('faq-ia'));
    session.edit((draft) => connectOutput(draft, session.getSnapshot().positions, 'crear-ticket', '/onError', 'fin-resuelto'));
    expect(session.getSnapshot().draftText.match(/"position"/g)).toHaveLength(7);
    expect(session.getSnapshot().saved!.text).not.toContain('position');
  });
});

describe('save', () => {
  it('200: envía el texto con la revisión leída y muestra la revisión nueva', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Leads v2'));
    const sent = session.getSnapshot().draftText;
    const saved = { ...clone('captacion-leads'), name: 'Leads v2' };
    client.puts = [ok(resource(saved, { revision: 2, name: 'Leads v2' }))];
    const outcome = await session.save();
    expect(outcome).toEqual({ status: 'saved', revision: 2 });
    expect(client.lastPut).toEqual({ text: sent, revision: 1 });
    expect(session.getSnapshot()).toMatchObject({ dirty: false, busy: null, announcement: { text: 'Guardado. Revisión 2.' } });
    expect(session.getSnapshot().saved?.revision).toBe(2);
  });

  it('lo escrito mientras se guarda sigue como cambio sin guardar', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('A'));
    let release: () => void = () => undefined;
    client.puts = [
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(resource({ ...clone('captacion-leads'), name: 'A' }, { revision: 2 })));
        }),
    ];
    const pending = session.save();
    session.edit(renameTo('AB'));
    release();
    await pending;
    expect(session.getSnapshot()).toMatchObject({ dirty: true });
    expect(session.getSnapshot().saved?.flow.name).toBe('A');
  });

  it('las barreras no envían nada: inválido, credencial y más de 1 MiB (saveInvalid, skipLiteralCredentialCheck)', async () => {
    const { session, client } = await opened();
    session.edit(writeTarget('/nodes/1/next', null));
    expect(await session.save()).toEqual({ status: 'blocked', reason: 'invalid' });
    expect(session.getSnapshot().notice).toMatchObject({ kind: 'blocked', text: 'Corrige los problemas antes de guardar.' });
    session.edit(writeTarget('/nodes/1/next', 'pedir-email'));
    session.edit((draft) => {
      const flow = structuredClone(draft);
      (flow.nodes as { request: { headers: unknown } }[])[6]!.request.headers = { Authorization: 'Bearer abc123' };
      return { ok: true, flow };
    });
    expect(session.getSnapshot().verdict?.valid).toBe(true);
    expect(await session.save()).toEqual({ status: 'blocked', reason: 'literal_credential' });
    expect(client.count('put')).toBe(0);
    session.dismissNotice();
    expect(session.getSnapshot().notice).toBeNull();
  });

  // Un flujo válido de 1 040 000 bytes con 10 000 caracteres más no se guarda.
  it('Flujo de más de 1 MiB', async () => {
    const base = { specVersion: '0.1', id: 'grande', name: 'Grande', start: 'm', nodes: [{ id: 'm', type: 'message', content: [{ kind: 'text', text: '' }], next: 'fin' }, { id: 'fin', type: 'end' }] } as FlowDoc;
    const overhead = flowText(base).length;
    (base.nodes as { content: { text: string }[] }[])[0]!.content[0]!.text = 'a'.repeat(1_040_000 - overhead);
    expect(flowText(base).length).toBe(1_040_000);
    const { session, client } = await opened(base);
    expect(session.getSnapshot().verdict?.valid).toBe(true);
    session.edit(writeText('/nodes/0/content/0/text', `${(base.nodes as { content: { text: string }[] }[])[0]!.content[0]!.text}${'b'.repeat(10_000)}`, true));
    expect(session.getSnapshot().draftText.length).toBe(1_050_000);
    expect(await session.save()).toEqual({ status: 'blocked', reason: 'too_large' });
    expect(session.getSnapshot().notice?.text).toBe('El flujo supera el tamaño máximo de 1 MiB.');
    expect(client.count('put')).toBe(0);
  });

  it('412: conserva los cambios y ofrece «Cargar el guardado» y «Guardar encima» con la currentRevision', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    client.puts = [fail(412, 'revision_mismatch', 2)];
    expect(await session.save()).toEqual({ status: 'conflict' });
    expect(session.getSnapshot().notice).toEqual({ kind: 'conflict', text: EDITOR_COPY.conflict, actions: ['reload', 'saveOver'], currentRevision: 2 });
    expect(session.getSnapshot().dirty).toBe(true);
    client.puts = [ok(resource({ ...clone('captacion-leads'), name: 'B' }, { revision: 3 }))];
    expect(await session.saveOver()).toEqual({ status: 'saved', revision: 3 });
    expect(client.lastPut?.revision).toBe(2);
    expect(client.count('put')).toBe(2);
  });

  it('otro 412 al guardar encima vuelve a ofrecerlo con la revisión nueva (ifMatchStar)', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    client.puts = [fail(412, 'revision_mismatch', 2), fail(412, 'revision_mismatch', 5)];
    await session.save();
    await session.saveOver();
    expect(client.lastPut?.revision).toBe(2);
    expect(session.getSnapshot().notice?.currentRevision).toBe(5);
    await session.saveOver();
    expect(client.lastPut?.revision).toBe(5);
  });

  it('un 412 sin currentRevision solo ofrece cargar el guardado', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    client.puts = [fail(412, 'revision_mismatch')];
    await session.save();
    expect(session.getSnapshot().notice?.actions).toEqual(['reload']);
    expect(await session.saveOver()).toEqual({ status: 'busy' });
  });

  it('Cargar el guardado descarta los cambios y vuelve a leer', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    client.puts = [fail(412, 'revision_mismatch', 2)];
    await session.save();
    client.gets = [ok(resource({ ...clone('captacion-leads'), name: 'A' }, { revision: 2 }))];
    expect(await session.reloadSaved()).toEqual({ status: 'reloaded' });
    expect(session.getSnapshot()).toMatchObject({ dirty: false, notice: null });
    expect(session.getSnapshot().saved).toMatchObject({ revision: 2, name: 'A' });
  });

  it('respuesta perdida: relee, y si el texto es el enviado lo da por guardado con la revisión leída; nunca reenvía', async () => {
    for (const lost of [fail(null, 'network_error'), fail(502, 'api_unreachable'), fail(502, 'invalid_api_response'), fail(500, 'internal_error'), fail(503, 'database_unavailable')]) {
      const { session, client } = await opened();
      session.edit(renameTo('Leads v2'));
      client.puts = [lost];
      client.gets = [ok(resource({ ...clone('captacion-leads'), name: 'Leads v2' }, { revision: 2 }))];
      expect(await session.save()).toEqual({ status: 'saved', revision: 2 });
      expect(client.count('put')).toBe(1);
      expect(session.getSnapshot()).toMatchObject({ dirty: false, announcement: { text: 'Guardado. Revisión 2.' } });
    }
  });

  it('respuesta perdida con una lectura distinta: conserva los cambios y dice que no consta (trustLostWithoutCompare)', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Leads v2'));
    client.puts = [fail(null, 'network_error')];
    client.gets = [ok(resource(clone('captacion-leads'), { revision: 1 }))];
    expect(await session.save()).toEqual({ status: 'unconfirmed' });
    expect(session.getSnapshot().notice).toMatchObject({ kind: 'unconfirmed', text: EDITOR_COPY.unconfirmed });
    expect(session.getSnapshot()).toMatchObject({ dirty: true });
    expect(session.getSnapshot().saved?.revision).toBe(1);
    expect(client.count('put')).toBe(1);
  });

  it('respuesta perdida con la lectura fallida: no consta, con la variante de base de datos', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Leads v2'));
    client.puts = [fail(503, 'database_unavailable')];
    client.gets = [fail(503, 'database_unavailable')];
    expect(await session.save()).toEqual({ status: 'unconfirmed' });
    expect(session.getSnapshot().notice?.text).toBe(EDITOR_COPY.unconfirmedDatabase);
    expect(client.count('put')).toBe(1);
  });

  it('404, 400, 413 y el resto muestran su texto y conservan los cambios', async () => {
    const cases: [ClientResult<never>, string][] = [
      [fail(404, 'flow_not_found'), EDITOR_COPY.gone],
      [fail(400, 'invalid_flow'), 'La API de Franca considera que el flujo no es válido.'],
      [fail(400, 'literal_credential'), 'La API de Franca no guarda credenciales escritas: usa un secreto.'],
      [fail(413, 'payload_too_large'), 'El flujo supera el tamaño máximo de 1 MiB.'],
      [fail(400, 'flow_id_mismatch'), 'No se ha podido guardar el flujo.'],
      [fail(428, 'precondition_required'), 'No se ha podido guardar el flujo.'],
      [fail(403, 'unknown'), 'No se ha podido guardar el flujo.'],
    ];
    for (const [result, text] of cases) {
      const { session, client } = await opened();
      session.edit(renameTo('Otro'));
      client.puts = [result];
      await session.save();
      expect(session.getSnapshot().notice?.text, text).toBe(text);
      expect(session.getSnapshot()).toMatchObject({ dirty: true, busy: null });
      expect(client.count('get')).toBe(1);
    }
  });

  it('busy descarta la segunda pulsación', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    let release: () => void = () => undefined;
    client.puts = [
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(resource({ ...clone('captacion-leads'), name: 'B' }, { revision: 2 })));
        }),
    ];
    const first = session.save();
    expect(session.getSnapshot().busy).toBe('saving');
    expect(await session.save()).toEqual({ status: 'busy' });
    expect(await session.publish()).toEqual({ status: 'busy' });
    expect(await session.remove()).toEqual({ status: 'busy' });
    expect(await session.reloadSaved()).toEqual({ status: 'busy' });
    release();
    await first;
    expect(client.count('put')).toBe(1);
  });

  it('reset y la época descartan una respuesta tardía', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('B'));
    let release: () => void = () => undefined;
    client.puts = [
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(resource({ ...clone('captacion-leads'), name: 'B' }, { revision: 2 })));
        }),
    ];
    const pending = session.save();
    session.reset();
    release();
    expect(await pending).toEqual({ status: 'ignored' });
    expect(session.getSnapshot().phase).toBe('loading');
    expect(session.getSnapshot().saved).toBeNull();
  });

  it('una lectura tardía tras reset no vuelve a poner el borrador (ignoreEpoch)', async () => {
    const client = new FakeClient();
    let release: () => void = () => undefined;
    client.gets = [
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok(resource(clone('hola'))));
        }),
    ];
    const session = new EditorSession('hola', client);
    const pending = session.open();
    session.reset();
    release();
    await pending;
    expect(session.getSnapshot().phase).toBe('loading');
  });
});

describe('persistencia del diseño automático', () => {
  it('abrir y salir nunca crea cambios: no hay ningún PUT', async () => {
    const { session, client } = await opened(clone('faq-ia'));
    expect(session.getSnapshot().dirty).toBe(false);
    session.reset();
    await session.open();
    expect(client.count('put')).toBe(0);
    expect(session.getSnapshot().draftText).not.toContain('position');
  });
});

describe('publish', () => {
  // Dice que hay que guardar y no llama a la API.
  it('Publicar con cambios sin guardar', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Otro'));
    expect(await session.publish()).toEqual({ status: 'blocked', reason: 'unsaved_changes' });
    expect(session.getSnapshot().notice?.text).toBe('Guarda los cambios antes de publicar.');
    expect(client.count('publish')).toBe(0);
  });

  it('201 anuncia la versión nueva; 200, que ya la tenía; ambos actualizan latestVersion y el aviso', async () => {
    const { session, client } = await opened();
    client.publishes = [ok({ flowId: 'captacion-leads', version: 1, name: 'x' }, 201)];
    expect(await session.publish()).toEqual({ status: 'published', version: 1, created: true });
    expect(session.getSnapshot()).toMatchObject({ announcement: { text: 'Publicada la versión 1.' }, saved: { latestVersion: 1, unpublishedChanges: false, revision: 1 } });
    client.publishes = [ok({ flowId: 'captacion-leads', version: 1, name: 'x' }, 200)];
    expect(await session.publish()).toEqual({ status: 'published', version: 1, created: false });
    expect(session.getSnapshot().announcement?.text).toBe('La versión 1 ya tiene este borrador.');
  });

  it('412 ofrece «Cargar el guardado»; 404 dice que se borró; el resto, su texto', async () => {
    const { session, client } = await opened();
    client.publishes = [fail(412, 'revision_mismatch', 2)];
    expect(await session.publish()).toEqual({ status: 'changed_outside' });
    expect(session.getSnapshot().notice).toMatchObject({ kind: 'changed_outside', text: 'El flujo ha cambiado fuera del editor.', actions: ['reload'] });
    client.publishes = [fail(404, 'flow_not_found')];
    expect(await session.publish()).toEqual({ status: 'gone' });
    client.publishes = [fail(null, 'network_error')];
    expect(await session.publish()).toEqual({ status: 'error' });
    expect(session.getSnapshot().notice?.text).toBe('No se puede conectar con la API de Franca.');
    client.publishes = [fail(500, 'internal_error')];
    await session.publish();
    expect(session.getSnapshot().notice?.text).toBe('No se ha podido publicar el flujo.');
    expect(client.count('get')).toBe(1);
  });
});

describe('probar', () => {
  // `checkTryable` lo impide y no se llama al `start` falso.
  it('Probar sin versión publicada', async () => {
    const { session } = await opened(clone('hola'));
    const { saved, dirty } = session.getSnapshot();
    const gate = checkTryable({ latestVersion: saved!.latestVersion, dirty });
    const start = vi.fn();
    if (gate.ok) start();
    expect(gate).toEqual({ ok: false, reason: 'no_version', message: 'Publica el flujo antes de probarlo.' });
    expect(start).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('204 y 404 dejan salir; 412 ofrece cargar el guardado; el resto, su texto', async () => {
    const { session, client } = await opened();
    client.deletes = [ok(null, 204)];
    expect(await session.remove()).toEqual({ status: 'deleted' });
    client.deletes = [fail(404, 'flow_not_found')];
    expect(await session.remove()).toEqual({ status: 'deleted' });
    client.deletes = [fail(412, 'revision_mismatch', 3)];
    expect(await session.remove()).toEqual({ status: 'changed_outside' });
    expect(session.getSnapshot().notice?.actions).toEqual(['reload']);
    client.deletes = [fail(null, 'network_error')];
    expect(await session.remove()).toEqual({ status: 'error' });
    expect(session.getSnapshot().notice?.text).toBe('No se puede conectar con la API de Franca.');
    client.deletes = [fail(500, 'internal_error')];
    await session.remove();
    expect(session.getSnapshot().notice?.text).toBe('No se ha podido borrar el flujo.');
  });
});

describe('reloadSaved', () => {
  it('Descartar cambios vuelve a leer y deja el editor sin cambios', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Otro'));
    session.select({ kind: 'node', id: 'aviso-error' });
    session.edit((draft) => ({ ok: true, flow: { ...draft, nodes: (draft.nodes as { id: string }[]).filter((node) => node.id !== 'aviso-error') } }));
    expect(session.getSnapshot().selection).toBeNull();
    expect(await session.reloadSaved()).toEqual({ status: 'reloaded' });
    expect(session.getSnapshot()).toMatchObject({ dirty: false, notice: null });
    expect((session.getSnapshot().draft!.nodes as unknown[]).length).toBe(11);
    expect(client.count('get')).toBe(2);
  });

  it('si la lectura falla conserva los cambios con el aviso; con 404 dice que se borró', async () => {
    const { session, client } = await opened();
    session.edit(renameTo('Otro'));
    client.gets = [fail(null, 'network_error')];
    expect(await session.reloadSaved()).toEqual({ status: 'error' });
    expect(session.getSnapshot()).toMatchObject({ dirty: true, busy: null });
    expect(session.getSnapshot().notice?.text).toBe('No se puede conectar con la API de Franca.');
    client.gets = [fail(404, 'flow_not_found')];
    expect(await session.reloadSaved()).toEqual({ status: 'gone' });
    expect(session.getSnapshot().notice?.text).toBe(EDITOR_COPY.gone);
  });

  it('say anuncia con un seq nuevo aunque el texto se repita', async () => {
    const { session } = await opened();
    session.say('Copiado.');
    const first = session.getSnapshot().announcement!.seq;
    session.say('Copiado.');
    expect(session.getSnapshot().announcement!.seq).toBe(first + 1);
  });
});
