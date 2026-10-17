import Link from 'next/link';
import { WEB_PAGES } from '@/config/endpoints';
import { COPY } from '@/lib/chat/copy';

/** «Conversación no encontrada» con un enlace al inicio. Sin llamar a nada: lo usa también la ruta con un id que no es un UUID. */
export function ConversationNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">{COPY.conversationNotFound}</h1>
      <p className="text-sm opacity-70">{COPY.conversationNotFoundBody}</p>
      <Link href={WEB_PAGES.home} className="self-start text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        {COPY.backHome}
      </Link>
    </main>
  );
}
