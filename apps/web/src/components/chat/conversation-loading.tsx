import { COPY } from '@/lib/chat/copy';

/** Esqueleto mientras se abre una conversación. */
export function ConversationLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8" aria-busy="true">
      <p role="status" className="text-sm opacity-70">
        {COPY.conversationLoading}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-foreground/10" />
        <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-foreground/10" />
        <div className="h-10 w-3/5 animate-pulse rounded-2xl bg-foreground/10" />
      </div>
    </main>
  );
}
