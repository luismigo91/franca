import { COPY } from '@/lib/chat/copy';
import type { ContentItem } from '@/lib/chat/events';
import { admitUrl } from '@/lib/chat/url-filter';

type MediaContent = Exclude<ContentItem, { kind: 'text' }>;

/**
 * Multimedia del flujo (D13). Se decide sobre la URL parseada y se pinta su `href`, nunca el texto original. Una
 * dirección no admitida no carga nada: «Contenido no disponible» y su `alt`. Sin `next/image` (el servidor de la web
 * pediría la URL) y sin `Referer` (`referrerPolicy` donde existe; en `video` y `audio` lo da la política del documento).
 */
export function MediaItem({ item }: { item: MediaContent }) {
  const href = admitUrl(item.url, item.kind);
  if (href === null) {
    return (
      <div className="rounded border border-dashed border-foreground/40 px-3 py-2 text-sm">
        <p>{COPY.mediaUnavailable}</p>
        {item.alt !== undefined && <p className="opacity-70 [overflow-wrap:anywhere]">{item.alt}</p>}
      </div>
    );
  }
  switch (item.kind) {
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element -- next/image haría que el servidor de la web pidiera la URL remota (SSRF desde la frontera, D13).
        <img src={href} alt={item.alt ?? ''} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="h-auto max-h-80 max-w-full rounded" />
      );
    case 'video':
      return <video src={href} controls preload="metadata" aria-label={item.alt ?? COPY.videoName} className="max-h-80 max-w-full rounded" />;
    case 'audio':
      return <audio src={href} controls preload="none" aria-label={item.alt ?? COPY.audioName} className="w-full max-w-full" />;
    case 'embed':
      // Sin allow-same-origin, allow-top-navigation*, allow-popups ni allow-forms: queda en un origen opaco y no puede navegar el chat.
      return (
        <iframe
          src={href}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          title={item.alt ?? COPY.embedTitle}
          className="aspect-video w-full max-w-full rounded border border-foreground/20"
        />
      );
  }
}
