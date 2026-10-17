'use client';

import { useState } from 'react';
import { ContactField } from '@/components/chat/contact-field';
import { ConversationList } from '@/components/chat/conversation-list';
import { FlowList } from '@/components/chat/flow-list';
import { ListState } from '@/components/chat/list-state';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
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
  const { state: start, start: startFlow } = useStartConversation(flows.reload);

  const contactError = start.error?.code === 'invalid_request' ? errorCopy('start', 'invalid_request') : null;
  const startError = start.error !== null && start.error.code !== 'invalid_request' ? errorCopy('start', start.error.code) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          {COPY.appTitle} de {COPY.brand}
        </h1>
        <p className="text-sm opacity-70">{COPY.pageDescription}</p>
      </header>

      <ContactField value={contactId} onChange={setContactId} error={contactError} />

      {startError !== null && <Notice tone="error">{startError}</Notice>}

      <section aria-labelledby="flows-heading" className="flex flex-col gap-3">
        <h2 id="flows-heading" className="text-lg font-semibold">
          {COPY.flowsHeading}
        </h2>
        <ListState
          phase={flows.state.phase}
          loadingText={COPY.loadingFlows}
          emptyText={COPY.noFlows}
          isEmpty={flows.state.list.items.length === 0}
          error={flows.state.error}
          onRetry={flows.reload}
        >
          <FlowList flows={flows.state.list.items} startingFlowId={start.startingFlowId} onTry={(flowId) => void startFlow(flowId, contactId)} />
          {flows.state.error !== null && <Notice tone="error">{errorCopy('list', flows.state.error)}</Notice>}
          {flows.state.more && (
            <Button variant="secondary" className="self-start" aria-label="Ver más flujos" disabled={flows.state.loadingMore} onClick={() => void flows.loadMore()}>
              {COPY.more}
            </Button>
          )}
        </ListState>
      </section>

      <section aria-labelledby="conversations-heading" className="flex flex-col gap-3">
        <h2 id="conversations-heading" className="text-lg font-semibold">
          {COPY.conversationsHeading}
        </h2>
        <ListState
          phase={conversations.state.phase}
          loadingText={COPY.loadingConversations}
          emptyText={COPY.noConversations}
          isEmpty={conversations.state.list.items.length === 0}
          error={conversations.state.error}
          onRetry={conversations.reload}
        >
          <ConversationList conversations={conversations.state.list.items} />
          {conversations.state.error !== null && <Notice tone="error">{errorCopy('list', conversations.state.error)}</Notice>}
          {conversations.state.more && (
            <Button variant="secondary" className="self-start" aria-label="Ver más conversaciones" disabled={conversations.state.loadingMore} onClick={() => void conversations.loadMore()}>
              {COPY.more}
            </Button>
          )}
        </ListState>
      </section>
    </main>
  );
}
