'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlowCanvas, type CanvasHandle } from '@/components/editor/canvas/flow-canvas';
import { ConfirmDialog } from '@/components/editor/confirm-dialog';
import { EditorActions } from '@/components/editor/editor-actions';
import { EditorHeader } from '@/components/editor/editor-header';
import { EditorLoading } from '@/components/editor/editor-loading';
import { EditorNotFound } from '@/components/editor/editor-not-found';
import { FlowJsonDialog } from '@/components/editor/flow-json-dialog';
import { FlowPanel } from '@/components/editor/flow-panel';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { NodeInspector } from '@/components/editor/inspector/node-inspector';
import { NodeJsonDialog } from '@/components/editor/node-json-dialog';
import { ProblemsList } from '@/components/editor/problems-list';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { WEB_PAGES } from '@/config/endpoints';
import { useEditorSession } from '@/hooks/use-editor-session';
import { useStartConversation } from '@/hooks/use-start-conversation';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { errorCopy } from '@/lib/chat/copy';
import { NODE_HEADER_HEIGHT, NODE_WIDTH } from '@/lib/editor/canvas-geometry';
import { editorErrorCopy, EDITOR_COPY } from '@/lib/editor/copy';
import { resolveDrop } from '@/lib/editor/drop';
import { hasShapeProblems, problemsByNode, problemsOf, summarizeProblems, type Problem } from '@/lib/editor/issues-view';
import { isRecord } from '@/lib/editor/json-edit';
import { deleteNode, replaceNodeJson } from '@/lib/editor/node-ops';
import { addNode, nextNodeId } from '@/lib/editor/node-templates';
import { moveNode } from '@/lib/editor/positions';
import { renameNode } from '@/lib/editor/rename';
import { checkTryable } from '@/lib/editor/save-gate';

type FocusTarget = 'title' | 'problems' | 'inspector' | 'canvas' | { node: string };

/** Lleva el foco al elemento que corresponde a una acción (D17), una vez pintado. */
function focusElement(target: FocusTarget): void {
  const element =
    target === 'title'
      ? document.getElementById('editor-title')
      : target === 'problems'
        ? document.getElementById('problems-title')
        : target === 'inspector'
          ? document.getElementById('inspector-title')
          : target === 'canvas'
            ? document.getElementById('flow-canvas')
            : document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(target.node)}"]`);
  element?.focus();
}

/**
 * La pantalla de un flujo (D4, D17, D18). Cliente: el borrador es estado vivo. Recorre las fases de la sesión: leyendo, no
 * encontrado, error de lectura y listo (cabecera, acciones, lienzo, problemas y el inspector o el panel del flujo).
 */
export function EditorScreen({ flowId }: { flowId: string }) {
  const { session, snapshot } = useEditorSession(flowId);
  const router = useRouter();
  const canvas = useRef<CanvasHandle>(null);
  const [focus, setFocus] = useState<{ target: FocusTarget; seq: number } | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'flow' | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [viewingJson, setViewingJson] = useState(false);
  const [editingNodeJson, setEditingNodeJson] = useState(false);
  const [tryMessage, setTryMessage] = useState<string | null>(null);
  const start = useStartConversation(() => undefined);
  const lastSummary = useRef<string | null>(null);

  const { draft, saved, verdict, positions, selection } = snapshot;
  const ready = snapshot.phase === 'ready' && draft !== null && saved !== null && verdict !== null;
  useUnsavedGuard(ready && snapshot.dirty);

  const problems = useMemo(() => (verdict === null ? [] : problemsOf(verdict)), [verdict]);
  const byNode = useMemo(() => problemsByNode(problems), [problems]);
  const summary = summarizeProblems(problems);

  // El número de problemas se anuncia cuando cambia (no al cargar).
  useEffect(() => {
    if (!ready) {
      lastSummary.current = null;
      return;
    }
    if (lastSummary.current !== null && lastSummary.current !== summary) session.say(summary);
    lastSummary.current = summary;
  }, [ready, summary, session]);

  useEffect(() => {
    if (focus !== null) focusElement(focus.target);
  }, [focus]);

  const requestFocus = (target: FocusTarget) => setFocus((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));

  if (snapshot.phase === 'loading') return <EditorLoading />;
  if (snapshot.phase === 'not_found') return <EditorNotFound />;
  if (snapshot.phase === 'load_error') {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
        <h1 className="text-xl font-semibold">No se ha podido abrir el flujo</h1>
        <Notice tone="error">{editorErrorCopy('open', snapshot.loadError ?? 'unknown')}</Notice>
        <div className="flex gap-3">
          <Button onClick={() => void session.open()}>Reintentar</Button>
          <Link href={WEB_PAGES.flows} className="self-center underline underline-offset-2">
            Volver a los flujos
          </Link>
        </div>
      </main>
    );
  }
  if (!ready) return <EditorLoading />;

  const nodes: unknown[] = Array.isArray(draft.nodes) ? (draft.nodes as unknown[]) : [];
  const nodeIds = nodes.flatMap((node) => (isRecord(node) && typeof node.id === 'string' ? [node.id] : []));
  const selectedIndex = selection?.kind === 'node' ? nodes.findIndex((node) => isRecord(node) && node.id === selection.id) : -1;
  const selectedNode = selectedIndex === -1 ? null : nodes[selectedIndex];
  const selectedId = isRecord(selectedNode) && typeof selectedNode.id === 'string' ? selectedNode.id : null;

  const fieldContext: FieldContext = {
    flow: draft,
    nodeId: selectedId,
    nodeBase: selectedId === null ? '' : `/nodes/${selectedIndex}`,
    positions,
    nodeIds,
    problems,
    edit: (change) => session.edit(change),
    rename: (from, to) => {
      const result = session.edit((current) => renameNode(current, from, to));
      if (result.ok) session.select({ kind: 'node', id: to });
      return result;
    },
  };

  const onPick = (problem: Problem) => {
    const known = problem.nodeId !== null && nodeIds.includes(problem.nodeId);
    session.select(known ? { kind: 'node', id: problem.nodeId! } : { kind: 'flow' });
    if (known) canvas.current?.scrollToNode(problem.nodeId!);
    requestFocus('inspector');
  };

  const onSave = async () => {
    const outcome = await session.save();
    if (outcome.status === 'blocked' && outcome.reason !== 'unchanged') requestFocus('problems');
  };

  const onTry = () => {
    const gate = checkTryable({ latestVersion: saved.latestVersion, dirty: snapshot.dirty });
    if (!gate.ok) {
      setTryMessage(gate.message);
      return;
    }
    setTryMessage(null);
    void start.start(flowId, '');
  };

  const onReload = async () => {
    const outcome = await session.reloadSaved();
    if (outcome.status === 'reloaded') requestFocus('title');
  };

  const onAddNode = (type: string) => {
    const id = nextNodeId(draft, type);
    const center = canvas.current?.visibleCenter() ?? { x: 0, y: 0 };
    const result = session.edit((current) => {
      const added = addNode(current, type, positions, { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEADER_HEIGHT / 2 });
      return added === null ? { ok: false, error: '' } : { ok: true, flow: added.flow };
    });
    if (!result.ok) return;
    session.select({ kind: 'node', id });
    requestFocus({ node: id });
  };

  const startError = start.state.error !== null ? errorCopy('start', start.state.error.code) : null;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[110rem] flex-1 flex-col gap-3 px-4 py-4">
      <EditorHeader flowId={flowId} saved={saved} dirty={snapshot.dirty} />
      <EditorActions
        snapshot={snapshot}
        starting={start.state.startingFlowId !== null}
        onSave={() => void onSave()}
        onPublish={() => void session.publish()}
        onTry={onTry}
        onDiscard={() => setConfirm('discard')}
        onViewJson={() => setViewingJson(true)}
        onAddNode={onAddNode}
        onDeleteFlow={() => setConfirm('flow')}
      />
      {snapshot.notice !== null && (
        <Notice tone="error">
          <p>{snapshot.notice.text}</p>
          {snapshot.notice.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {snapshot.notice.actions.includes('reload') && (
                <Button variant="secondary" aria-disabled={snapshot.busy !== null || undefined} onClick={() => void onReload()}>
                  Cargar el guardado
                </Button>
              )}
              {snapshot.notice.actions.includes('saveOver') && (
                <Button variant="secondary" aria-disabled={snapshot.busy !== null || undefined} onClick={() => void session.saveOver()}>
                  Guardar encima
                </Button>
              )}
            </div>
          )}
        </Notice>
      )}
      {tryMessage !== null && <Notice tone="error">{tryMessage}</Notice>}
      {startError !== null && <Notice tone="error">{startError}</Notice>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <FlowCanvas
          flow={draft}
          positions={positions}
          selectedId={selectedId}
          problems={byNode}
          handleRef={canvas}
          onSelect={(id) => session.select(id === null ? null : { kind: 'node', id })}
          onMoveNode={(id, dx, dy) => {
            session.edit((current) => ({ ok: true, flow: moveNode(current, id, dx, dy, positions) }));
          }}
          onConnect={(sourceId, pointer, targetId, cancelled) => {
            const result = resolveDrop({ flow: draft, positions, sourceId, outputPointer: pointer, targetId, cancelled });
            if (result.kind === 'connect') session.edit(() => ({ ok: true, flow: result.flow }));
            else if (result.kind === 'reject') session.say(EDITOR_COPY.selfJump);
          }}
        />
        <aside aria-label="Problemas e inspector" className="flex min-w-0 flex-col gap-5 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pr-1">
          <ProblemsList problems={problems} shapeProblems={verdict !== null && hasShapeProblems(verdict)} onPick={onPick} />
          {selectedId !== null ? (
            <NodeInspector
              key={`${snapshot.loadCount}:${selectedId}`}
              ctx={fieldContext}
              index={selectedIndex}
              onEditJson={() => setEditingNodeJson(true)}
              onDelete={() => setNodeToDelete(selectedId)}
            />
          ) : (
            <FlowPanel key={snapshot.loadCount} ctx={fieldContext} />
          )}
          {selectedId !== null && (
            <Button variant="secondary" className="self-start" onClick={() => session.select({ kind: 'flow' })}>
              Propiedades del flujo
            </Button>
          )}
        </aside>
      </div>

      <FlowJsonDialog
        open={viewingJson}
        text={snapshot.draftText}
        onClose={() => setViewingJson(false)}
        onCopy={() => {
          void navigator.clipboard.writeText(snapshot.draftText).then(() => session.say(EDITOR_COPY.copied));
        }}
      />
      <NodeJsonDialog
        open={editingNodeJson}
        initialText={selectedNode === null ? '' : (JSON.stringify(selectedNode, null, 2) ?? '')}
        onClose={() => setEditingNodeJson(false)}
        onApply={(text) => {
          if (selectedId === null) return 'El nodo ya no existe.';
          const result = session.edit((current) => replaceNodeJson(current, selectedId, text));
          if (!result.ok) return result.error;
          const written = JSON.parse(text) as { id?: unknown };
          if (typeof written.id === 'string' && written.id !== selectedId) session.select({ kind: 'node', id: written.id });
          setEditingNodeJson(false);
          return null;
        }}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title="¿Descartar los cambios?"
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void onReload();
        }}
      >
        Se vuelve a leer el borrador de la API y se pierden los cambios sin guardar.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'flow'}
        title="¿Borrar el flujo?"
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void session.remove().then((outcome) => {
            if (outcome.status === 'deleted') router.push(WEB_PAGES.flows);
          });
        }}
      >
        El identificador «{flowId}» queda reservado para siempre: no se podrá crear otro flujo con él. Las versiones publicadas y sus conversaciones se conservan.
      </ConfirmDialog>
      <ConfirmDialog
        open={nodeToDelete !== null}
        title="¿Borrar el nodo?"
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        danger
        onCancel={() => setNodeToDelete(null)}
        onConfirm={() => {
          const id = nodeToDelete;
          setNodeToDelete(null);
          if (id === null) return;
          session.edit((current) => ({ ok: true, flow: deleteNode(current, id) }));
          session.select(null);
          requestFocus('canvas');
        }}
      >
        Se borra el nodo «{nodeToDelete}». Los saltos que apuntaban a él quedan rotos y el validador los señala. «Descartar cambios» lo recupera mientras no se guarde.
      </ConfirmDialog>
    </main>
  );
}
