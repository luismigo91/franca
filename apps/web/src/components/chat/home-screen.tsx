'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ContactField } from '@/components/chat/contact-field';
import { ConversationList } from '@/components/chat/conversation-list';
import { FlowList } from '@/components/chat/flow-list';
import { ListState } from '@/components/chat/list-state';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { WEB_PAGES } from '@/config/endpoints';
import { useListFocus } from '@/hooks/use-list-focus';
import { usePagedList } from '@/hooks/use-paged-list';
import { useStartConversation } from '@/hooks/use-start-conversation';
import type { ConversationSummary, FlowSummary, Page } from '@/lib/chat/api-types';
import { COPY, errorCopy } from '@/lib/chat/copy';
import { webClient, type ClientResult } from '@/lib/web-client';

// Lectores de módulo: estables entre renders, como pide `usePagedList`.
const readFlows = (offset: number, signal: AbortSignal): Promise<ClientResult<Page<FlowSummary>>> => webClient.listFlows(offset, signal);
const readConversations = (offset: number, signal: AbortSignal): Promise<ClientResult<Page<ConversationSummary>>> => webClient.listConversations(offset, signal);

/** Página de inicio (D16): flujos publicados, el campo de contacto y las conversaciones recientes. */
export function HomeScreen() {
  const [contactId, setContactId] = useState('');
  const flows = usePagedList(readFlows);
  const conversations = usePagedList(readConversations);
  const [flowsSection, rememberFlows] = useListFocus(flows.state.phase === 'loading' || flows.state.loadingMore);
  const [conversationsSection, rememberConversations] = useListFocus(conversations.state.phase === 'loading' || conversations.state.loadingMore);
  const contactInput = useRef<HTMLInputElement>(null);
  const reloadFlows = () => {
    rememberFlows(-1);
    void flows.reload();
  };
  const { state: start, start: startFlow } = useStartConversation(reloadFlows);

  // Si la API rechaza el identificador, el foco va al campo del contacto; con otros fallos se queda en el botón.
  const failedStart = start.error;
  useEffect(() => {
    if (failedStart?.code === 'invalid_request') contactInput.current?.focus();
  }, [failedStart]);

  const contactError = start.error?.code === 'invalid_request' ? errorCopy('start', 'invalid_request') : null;
  const startError = start.error !== null && start.error.code !== 'invalid_request' ? errorCopy('start', start.error.code) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {COPY.appTitle} de {COPY.brand}
        </h1>
        <p className="text-sm opacity-70">{COPY.pageDescription}</p>
        <Link href={WEB_PAGES.flows} className="self-start text-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          {COPY.editorLink}
        </Link>
      </header>

      <ContactField value={contactId} onChange={setContactId} error={contactError} inputRef={contactInput} />

      {startError !== null && <Notice tone="error">{startError}</Notice>}

      <section ref={flowsSection} aria-labelledby="flows-heading" className="flex flex-col gap-3">
        <h2 id="flows-heading" tabIndex={-1} className="text-lg font-semibold">
          {COPY.flowsHeading}
        </h2>
        <ListState
          phase={flows.state.phase}
          loadingText={COPY.loadingFlows}
          emptyText={
            <>
              {COPY.noFlows}{' '}
              <Link href={WEB_PAGES.flows} className="underline underline-offset-2">
                {COPY.goToEditor}
              </Link>
            </>
          }
          isEmpty={flows.state.list.items.length === 0}
          error={flows.state.error}
          onRetry={reloadFlows}
        >
          <FlowList flows={flows.state.list.items} startingFlowId={start.startingFlowId} onTry={(flowId) => void startFlow(flowId, contactId)} />
          {flows.state.error !== null && <Notice tone="error">{errorCopy('list', flows.state.error)}</Notice>}
          {flows.state.more && (
            <Button variant="secondary" className="self-start" aria-label={COPY.moreFlows} aria-disabled={flows.state.loadingMore || undefined} onClick={() => {
                if (flows.state.loadingMore) return;
                rememberFlows(flows.state.list.items.length);
                void flows.loadMore();
              }}>
              {COPY.more}
            </Button>
          )}
        </ListState>
      </section>

      <section ref={conversationsSection} aria-labelledby="conversations-heading" className="flex flex-col gap-3">
        <h2 id="conversations-heading" tabIndex={-1} className="text-lg font-semibold">
          {COPY.conversationsHeading}
        </h2>
        <ListState
          phase={conversations.state.phase}
          loadingText={COPY.loadingConversations}
          emptyText={COPY.noConversations}
          isEmpty={conversations.state.list.items.length === 0}
          error={conversations.state.error}
          onRetry={() => {
            rememberConversations(-1);
            void conversations.reload();
          }}
        >
          <ConversationList conversations={conversations.state.list.items} />
          {conversations.state.error !== null && <Notice tone="error">{errorCopy('list', conversations.state.error)}</Notice>}
          {conversations.state.more && (
            <Button variant="secondary" className="self-start" aria-label={COPY.moreConversations} aria-disabled={conversations.state.loadingMore || undefined} onClick={() => {
                if (conversations.state.loadingMore) return;
                rememberConversations(conversations.state.list.items.length);
                void conversations.loadMore();
              }}>
              {COPY.more}
            </Button>
          )}
        </ListState>
      </section>
    </main>
  );
}
