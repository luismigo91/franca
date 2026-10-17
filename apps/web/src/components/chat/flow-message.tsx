import { MediaItem } from '@/components/chat/media-item';
import { MessageText } from '@/components/chat/message-text';
import type { ContentItem } from '@/lib/chat/events';

/** Mensaje del flujo: sus elementos en orden, texto plano o multimedia admitida. */
export function FlowMessage({ content }: { content: ContentItem[] }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl rounded-tl-sm border border-foreground/15 bg-foreground/5 px-4 py-2">
        <span className="sr-only">Franca</span>
        {content.map((item, index) => (item.kind === 'text' ? <MessageText key={index} text={item.text} /> : <MediaItem key={index} item={item} />))}
      </div>
    </div>
  );
}
