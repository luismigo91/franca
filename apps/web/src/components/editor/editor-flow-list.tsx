import Link from 'next/link';
import { WEB_PAGES } from '@/config/endpoints';
import type { FlowSummary } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';

/** Todos los flujos vivos, en el orden de la API: nombre (enlace a su editor), id, última versión o «Sin publicar» y el aviso de cambios sin publicar. */
export function EditorFlowList({ flows }: { flows: FlowSummary[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {flows.map((flow) => (
        <li key={flow.id} className="rounded-md border border-foreground/20 px-4 py-3">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <Link href={WEB_PAGES.flowEditor(flow.id)} className="font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
              {flow.name}
            </Link>
            <p className="text-sm opacity-70">
              <code>{flow.id}</code>
              {' · '}
              {flow.latestVersion === null ? 'Sin publicar' : `Versión ${flow.latestVersion}`}
            </p>
            {flow.unpublishedChanges && <p className="mt-1 inline-block rounded border border-foreground/30 px-2 py-0.5 text-xs">{COPY.unpublishedChanges}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
