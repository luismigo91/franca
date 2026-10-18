import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { COPY, errorCopy, type ChatErrorCode } from '@/lib/chat/copy';

interface ListStateProps {
  phase: 'loading' | 'ready' | 'error';
  /** Texto de «Cargando…». */
  loadingText: string;
  /** Contenido de la lista vacía (un texto, o un texto con un enlace). */
  emptyText: ReactNode;
  isEmpty: boolean;
  error: ChatErrorCode | null;
  onRetry: () => void;
  children: ReactNode;
}

/** Los estados de una lista (loading, empty, error y success), con el texto en español y sin el de la API. */
export function ListState({ phase, loadingText, emptyText, isEmpty, error, onRetry, children }: ListStateProps) {
  if (phase === 'loading') {
    return (
      <p role="status" className="text-sm opacity-70">
        {loadingText}
      </p>
    );
  }
  if (phase === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-700 bg-red-700/10 px-3 py-2 text-sm dark:border-red-400">
        <p>{errorCopy('list', error ?? 'unknown')}</p>
        <Button variant="secondary" onClick={onRetry}>
          {COPY.retry}
        </Button>
      </div>
    );
  }
  if (isEmpty) return <p className="text-sm opacity-70">{emptyText}</p>;
  return <>{children}</>;
}
