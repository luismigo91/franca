'use client';

import { useState } from 'react';
import { ConversationHeader } from '@/components/chat/conversation-header';
import { ConversationLoading } from '@/components/chat/conversation-loading';
import { ConversationNotFound } from '@/components/chat/conversation-not-found';
import { ConversationNotice } from '@/components/chat/conversation-notice';
import { DeleteConversationDialog } from '@/components/chat/delete-conversation-dialog';
import { EndNotice } from '@/components/chat/end-notice';
import { MessageList } from '@/components/chat/message-list';
import { PendingQuestion } from '@/components/chat/pending-question';
import { TestDetailsPanel } from '@/components/chat/test-details-panel';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useConversationSession } from '@/hooks/use-conversation-session';
import { COPY, errorCopy } from '@/lib/chat/copy';

/** La pantalla de una conversación (D16). Cliente: la conversación es estado vivo (ritmo, envío, releer). */
export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const { session, snapshot } = useConversationSession(conversationId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (snapshot.phase === 'loading') return <ConversationLoading />;
  if (snapshot.phase === 'not_found') return <ConversationNotFound />;
  if (snapshot.phase === 'load_error') {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
        <Notice tone="error">{errorCopy('open', snapshot.loadError ?? 'unknown')}</Notice>
        <Button className="self-start" onClick={() => session.retryLoad()}>
          {COPY.retry}
        </Button>
      </main>
    );
  }

  const { conversation, pending, settled } = snapshot;
  const ended = settled && conversation !== null && conversation.status !== 'waiting';
  const questionKey = pending !== null && conversation !== null ? `${pending.nodeId}:${pending.attempt}:${conversation.revision}` : null;

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label="Chat" className="flex min-w-0 flex-col gap-4">
        <ConversationHeader
          header={snapshot.header}
          ended={ended}
          starting={snapshot.starting}
          onRestart={() => void session.restart()}
          onRemove={() => setConfirmingDelete(true)}
        />
        <MessageList timeline={snapshot.timeline} onPainted={session.acknowledge} />
        <TypingIndicator typing={snapshot.typing} />
        {snapshot.notice !== null && <ConversationNotice notice={snapshot.notice} onReload={() => void session.reload()} onRetry={() => void session.retry()} />}
        {pending !== null && questionKey !== null && !ended && (
          <PendingQuestion key={questionKey} question={pending} draft={snapshot.draft} disabled={snapshot.sending} onSend={(input, label) => void session.send(input, label)} />
        )}
        {ended && conversation !== null && <EndNotice conversation={conversation} starting={snapshot.starting} onRestart={() => void session.restart()} />}
      </section>
      <TestDetailsPanel conversation={conversation} activity={snapshot.activity} />
      <DeleteConversationDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          void session.remove();
        }}
      />
    </main>
  );
}
