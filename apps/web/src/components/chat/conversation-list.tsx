import Link from 'next/link';
import { WEB_PAGES } from '@/config/endpoints';
import type { ConversationSummary } from '@/lib/chat/api-types';
import { STATUS_COPY } from '@/lib/chat/copy';
import { formatDateTime } from '@/lib/chat/format';

/** Conversaciones recientes de la instalación; cada una abre su página. */
export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <Link
            href={WEB_PAGES.conversation(conversation.id)}
            prefetch={false}
            className="block rounded-md border border-foreground/20 px-4 py-3 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
              <span className="font-medium">{conversation.flowId}</span>
              <span className="text-sm opacity-70">Versión {conversation.version}</span>
              <span className="text-sm">{STATUS_COPY[conversation.status]}</span>
              {conversation.outcome !== null && <span className="text-sm">{conversation.outcome}</span>}
              {conversation.contactId !== null && <span className="text-sm opacity-70">Contacto {conversation.contactId}</span>}
            </span>
            <span className="mt-1 block text-xs opacity-70">
              Última actividad <time dateTime={conversation.updatedAt}>{formatDateTime(conversation.updatedAt)}</time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
