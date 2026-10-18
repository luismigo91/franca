import { AddNodeMenu } from '@/components/editor/add-node-menu';
import { Button } from '@/components/ui/button';
import type { EditorSnapshot } from '@/lib/editor/editor-session';

interface EditorActionsProps {
  snapshot: EditorSnapshot;
  /** «Probar» en curso. */
  starting: boolean;
  onSave: () => void;
  onPublish: () => void;
  onTry: () => void;
  onDiscard: () => void;
  onViewJson: () => void;
  onAddNode: (type: string) => void;
  onDeleteFlow: () => void;
}

/**
 * La barra de acciones. Un botón pulsado mientras se hace algo queda `aria-disabled` y no `disabled` (un botón `disabled`
 * enfocado manda el foco a `body`); lo que impide pulsarlo dos veces es la sesión (`busy`). «Probar» siempre se puede
 * pulsar: si no hay versión publicada o hay cambios sin guardar, lo dice.
 */
export function EditorActions({ snapshot, starting, onSave, onPublish, onTry, onDiscard, onViewJson, onAddNode, onDeleteFlow }: EditorActionsProps) {
  const busy = snapshot.busy !== null || undefined;
  const version = snapshot.saved?.latestVersion ?? null;
  const showsNote = !snapshot.dirty && version !== null && snapshot.saved?.unpublishedChanges === true;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <Button id="action-save" aria-disabled={busy} onClick={onSave}>
          {snapshot.busy === 'saving' ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button variant="secondary" aria-disabled={busy} onClick={onPublish}>
          {snapshot.busy === 'publishing' ? 'Publicando…' : 'Publicar'}
        </Button>
        <Button variant="secondary" aria-disabled={busy || starting || undefined} aria-describedby={showsNote ? 'try-note' : undefined} onClick={onTry}>
          {starting ? 'Iniciando…' : 'Probar'}
        </Button>
        <Button variant="secondary" aria-disabled={busy} onClick={onDiscard}>
          Descartar cambios
        </Button>
        <Button variant="secondary" onClick={onViewJson}>
          Ver JSON
        </Button>
        <AddNodeMenu onAdd={onAddNode} />
        <Button variant="danger" aria-disabled={busy} onClick={onDeleteFlow}>
          Borrar flujo
        </Button>
      </div>
      {showsNote && (
        <p id="try-note" className="text-sm opacity-80">
          Se probará la versión {version}, no el borrador.
        </p>
      )}
      <p role="status" className="min-h-5 text-sm [overflow-wrap:anywhere]">
        {snapshot.announcement?.text}
      </p>
    </div>
  );
}
