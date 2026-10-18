import { GuardedLink } from '@/components/editor/guarded-link';
import type { SavedState } from '@/lib/editor/editor-session';

const CHIP = 'rounded border border-foreground/40 px-2 py-0.5 text-xs';

/** Cabecera del editor: enlaces (con confirmación si hay cambios), nombre, id, revisión, última versión y avisos. */
export function EditorHeader({ flowId, saved, dirty }: { flowId: string; saved: SavedState; dirty: boolean }) {
  return (
    <header className="flex min-w-0 flex-col gap-2">
      <nav aria-label="Navegación del editor" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <GuardedLink page="home" dirty={dirty}>
          Chat de prueba
        </GuardedLink>
        <GuardedLink page="flows" dirty={dirty}>
          Flujos
        </GuardedLink>
      </nav>
      <h1 id="editor-title" tabIndex={-1} className="text-balance text-2xl font-semibold [overflow-wrap:anywhere]">
        {saved.name}
      </h1>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <code translate="no" className="[overflow-wrap:anywhere]">{flowId}</code>
        <span>Revisión {saved.revision}</span>
        <span>{saved.latestVersion === null ? 'Sin publicar' : `Versión ${saved.latestVersion}`}</span>
        {saved.unpublishedChanges && <span className={CHIP}>Cambios sin publicar</span>}
        {dirty && <span className={CHIP}>Cambios sin guardar</span>}
      </p>
    </header>
  );
}
