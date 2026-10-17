import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConversationLoading } from '@/components/chat/conversation-loading';
import { ConversationNotFound } from '@/components/chat/conversation-not-found';
import { ConversationScreen } from '@/components/chat/conversation-screen';
import { isConversationId } from '@/server/ids';

export const metadata: Metadata = { title: 'Conversación' };

// Sin `generateStaticParams`, `params` son datos de la petición y van dentro de <Suspense> (Cache Components, D1).
async function ConversationRoute({ params }: { params: PageProps<'/conversaciones/[conversationId]'>['params'] }) {
  const { conversationId } = await params;
  // Un id que no es un UUID en minúsculas no llega a ninguna llamada.
  if (!isConversationId(conversationId)) return <ConversationNotFound />;
  return <ConversationScreen key={conversationId} conversationId={conversationId} />;
}

export default function Page({ params }: PageProps<'/conversaciones/[conversationId]'>) {
  return (
    <Suspense fallback={<ConversationLoading />}>
      <ConversationRoute params={params} />
    </Suspense>
  );
}
