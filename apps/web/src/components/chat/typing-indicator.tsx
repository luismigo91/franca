import { COPY } from '@/lib/chat/copy';

/**
 * El indicador de «escribiendo». La región existe siempre (los lectores de pantalla anuncian los cambios de una región
 * que ya estaba en el documento) y solo tiene contenido mientras se espera.
 */
export function TypingIndicator({ typing }: { typing: boolean }) {
  return (
    <div role="status" className="min-h-6 text-sm opacity-70">
      {typing && (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-flex gap-1">
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-current" />
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-current [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-current [animation-delay:300ms]" />
          </span>
          {COPY.typing}
        </span>
      )}
    </div>
  );
}
