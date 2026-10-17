import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WEB_PAGES } from '@/config/endpoints';
import { COPY } from '@/lib/chat/copy';
import type { Notice } from '@/lib/chat/conversation-session';

interface ConversationNoticeProps {
  notice: Notice;
  onReload: () => void;
  onRetry: () => void;
}

const ERROR_KINDS: ReadonlySet<Notice['kind']> = new Set(['lost_not_sent', 'send_error', 'start_error', 'remove_error', 'load_failed', 'gone']);

/** Aviso de la conversación (otra pestaña, ocupada, envío perdido…) con su acción: Volver a cargar, Reintentar o el enlace al inicio. */
export function ConversationNotice({ notice, onReload, onRetry }: ConversationNoticeProps) {
  const isError = ERROR_KINDS.has(notice.kind);
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm ${isError ? 'border-red-700 bg-red-700/10 dark:border-red-400' : 'border-foreground/30 bg-foreground/5'}`}
    >
      <p>{notice.text}</p>
      {notice.action === 'reload' && (
        <Button variant="secondary" onClick={onReload}>
          {COPY.reload}
        </Button>
      )}
      {notice.action === 'retry' && (
        <Button variant="secondary" onClick={onRetry}>
          {COPY.retrySend}
        </Button>
      )}
      {notice.action === 'home' && (
        <Link href={WEB_PAGES.home} className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          {COPY.goneLink}
        </Link>
      )}
    </div>
  );
}
