'use client';

import { useLayoutEffect } from 'react';
import { FlowMessage } from '@/components/chat/flow-message';
import { UserMessage } from '@/components/chat/user-message';
import { COPY } from '@/lib/chat/copy';
import type { TimelineItem } from '@/lib/chat/transcript-view';

interface MessageListProps {
  timeline: TimelineItem[];
  /** La vista confirma que un mensaje ya está en el DOM: empieza la espera del siguiente (D10). */
  onPainted: (key: string) => void;
}

/** La conversación: una región de registro, para que los lectores de pantalla anuncien los mensajes nuevos. */
export function MessageList({ timeline, onPainted }: MessageListProps) {
  useLayoutEffect(() => {
    for (const item of timeline) onPainted(item.key);
  }, [timeline, onPainted]);

  return (
    <div role="log" aria-label={COPY.conversationLog} className="flex flex-col gap-3">
      {timeline.map((item) => (item.kind === 'flow' ? <FlowMessage key={item.key} content={item.content} /> : <UserMessage key={item.key} text={item.text} />))}
    </div>
  );
}
