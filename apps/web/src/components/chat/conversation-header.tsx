import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WEB_PAGES } from '@/config/endpoints';
import { COPY } from '@/lib/chat/copy';

interface ConversationHeaderProps {
  header: { title: string; version: number } | null;
  /** La conversación terminó: «Empezar de nuevo» y «Volver al inicio» van en el aviso de fin. */
  ended: boolean;
  starting: boolean;
  onRestart: () => void;
  onRemove: () => void;
}

/** Cabecera: el nombre de la versión (o el `flowId`), su número y las acciones de la página. */
export function ConversationHeader({ header, ended, starting, onRestart, onRemove }: ConversationHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-foreground/20 pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{header?.title ?? '…'}</h1>
        {header !== null && <p className="text-sm opacity-70">Versión {header.version}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!ended && (
          <Button aria-disabled={starting || undefined} onClick={starting ? undefined : onRestart}>
            {starting ? COPY.starting : COPY.restart}
          </Button>
        )}
        <Button variant="danger" onClick={onRemove}>
          {COPY.remove}
        </Button>
        {!ended && (
          <Link href={WEB_PAGES.home} className="px-2 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
            {COPY.backHome}
          </Link>
        )}
      </div>
    </header>
  );
}
