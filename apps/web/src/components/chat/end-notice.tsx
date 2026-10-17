'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { WEB_PAGES } from '@/config/endpoints';
import type { ConversationResource } from '@/lib/chat/api-types';
import { COPY } from '@/lib/chat/copy';

interface EndNoticeProps {
  conversation: Pick<ConversationResource, 'status' | 'outcome'>;
  starting: boolean;
  onRestart: () => void;
}

/**
 * Aviso de fin: «Conversación terminada» (con el `outcome` si lo tiene), «La conversación no ha podido continuar» o
 * «La conversación ha caducado por inactividad», con «Empezar de nuevo» y «Volver al inicio». Nunca lleva el `message`
 * de un `error`: este componente solo recibe el estado y el `outcome`.
 */
export function EndNotice({ conversation, starting, onRestart }: EndNoticeProps) {
  const section = useRef<HTMLElement>(null);
  // Al terminar la conversación el foco pasa al aviso de fin (la pregunta que lo tenía desaparece).
  useEffect(() => {
    section.current?.focus();
  }, []);
  const title = conversation.status === 'ended' ? COPY.endEnded : conversation.status === 'failed' ? COPY.endFailed : COPY.endExpired;
  return (
    <section ref={section} tabIndex={-1} aria-label={title} className="flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground flex-col gap-3 rounded-md border border-foreground/30 bg-foreground/5 px-4 py-3">
      <p className="font-medium">{title}</p>
      {conversation.status === 'ended' && conversation.outcome !== null && (
        <p className="text-sm">
          {COPY.outcome}: <code>{conversation.outcome}</code>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button aria-disabled={starting || undefined} onClick={starting ? undefined : onRestart}>
          {starting ? COPY.starting : COPY.restart}
        </Button>
        <Link href={WEB_PAGES.home} className="text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          {COPY.backHome}
        </Link>
      </div>
    </section>
  );
}
