'use client';

import Link from 'next/link';
import { useLayoutEffect, useState } from 'react';
import { EditorFlowList } from '@/components/editor/editor-flow-list';
import { NewFlowDialog } from '@/components/editor/new-flow-dialog';
import { ListState } from '@/components/chat/list-state';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { WEB_PAGES } from '@/config/endpoints';
import { useListFocus } from '@/hooks/use-list-focus';
import { usePagedList } from '@/hooks/use-paged-list';
import type { FlowSummary, Page } from '@/lib/chat/api-types';
import { COPY, errorCopy } from '@/lib/chat/copy';
import { editorClient, type ClientResult } from '@/lib/web-client';

// Lector de módulo: estable entre renders, como pide `usePagedList`.
const readFlows = (offset: number, signal: AbortSignal): Promise<ClientResult<Page<FlowSummary>>> => editorClient.listFlows(offset, signal);

/** `/flujos` (D16, D18): todos los flujos vivos, paginados, y «Nuevo flujo». Relee al mostrarse y vuelve a `loading` al ocultarse. */
export function FlowsScreen() {
  const flows = usePagedList(readFlows);
  const [section, remember] = useListFocus(flows.state.phase === 'loading' || flows.state.loadingMore);
  const [creating, setCreating] = useState(false);

  // El diálogo se cierra y se vacía al ocultarse la ruta (`<Activity>` conserva el estado).
  useLayoutEffect(() => () => setCreating(false), []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Flujos de {COPY.brand}</h1>
        <p className="text-sm opacity-70">Crea, edita, publica y prueba tus flujos.</p>
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={() => setCreating(true)}>Nuevo flujo</Button>
          <Link href={WEB_PAGES.home} className="text-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
            Chat de prueba
          </Link>
        </div>
      </header>

      <section ref={section} aria-labelledby="editor-flows-heading" className="flex flex-col gap-3">
        <h2 id="editor-flows-heading" tabIndex={-1} className="text-lg font-semibold">
          Todos los flujos
        </h2>
        <ListState
          phase={flows.state.phase}
          loadingText={COPY.loadingFlows}
          emptyText="Todavía no hay flujos. Crea el primero con «Nuevo flujo»."
          isEmpty={flows.state.list.items.length === 0}
          error={flows.state.error}
          onRetry={() => {
            remember(-1);
            void flows.reload();
          }}
        >
          <EditorFlowList flows={flows.state.list.items} />
          {flows.state.error !== null && <Notice tone="error">{errorCopy('list', flows.state.error)}</Notice>}
          {flows.state.more && (
            <Button
              variant="secondary"
              className="self-start"
              aria-label={COPY.moreFlows}
              aria-disabled={flows.state.loadingMore || undefined}
              onClick={() => {
                if (flows.state.loadingMore) return;
                remember(flows.state.list.items.length);
                void flows.loadMore();
              }}
            >
              {COPY.more}
            </Button>
          )}
        </ListState>
      </section>

      <NewFlowDialog open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}
