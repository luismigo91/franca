import { Button } from '@/components/ui/button';
import type { FlowSummary } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';

interface FlowListProps {
  flows: FlowSummary[];
  startingFlowId: string | null;
  onTry: (flowId: string) => void;
}

/** Flujos publicados, en el orden de la API. Mientras se crea una conversación, su botón dice «Iniciando…» y los demás se desactivan. */
export function FlowList({ flows, startingFlowId, onTry }: FlowListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {flows.map((flow) => {
        const starting = startingFlowId === flow.id;
        return (
          <li key={flow.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-foreground/20 px-4 py-3">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="font-medium">{flow.name}</p>
              <p className="text-sm opacity-70">
                <code>{flow.id}</code>
                {' · '}
                Versión {flow.latestVersion}
              </p>
              {flow.unpublishedChanges && <p className="mt-1 inline-block rounded border border-foreground/30 px-2 py-0.5 text-xs">{COPY.unpublishedChanges}</p>}
            </div>
            <Button aria-label={starting ? undefined : `${COPY.try} ${flow.name}`} disabled={startingFlowId !== null} onClick={() => onTry(flow.id)}>
              {starting ? COPY.starting : COPY.try}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
