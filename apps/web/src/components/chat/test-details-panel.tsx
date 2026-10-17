import { TechnicalActivity } from '@/components/chat/technical-activity';
import type { ConversationResource } from '@/lib/chat/api-types';
import { COPY, STATUS_COPY } from '@/lib/chat/copy';
import { formatCost, formatDateTime } from '@/lib/chat/format';
import { readPendingQuestion } from '@/lib/chat/events';
import type { ActivityItem } from '@/lib/chat/transcript-view';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-foreground/10 py-2 last:border-b-0">
      <dt className="text-xs opacity-70">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * Panel «Detalles de la prueba» (D16): el recurso conversación y la actividad técnica, separados de la conversación.
 * Nunca el `message` de un `error`: el recurso solo trae `error.code` y `error.nodeId`.
 */
export function TestDetailsPanel({ conversation, activity }: { conversation: ConversationResource | null; activity: ActivityItem[] }) {
  const pending = conversation !== null ? readPendingQuestion(conversation.pendingInput) : null;
  return (
    <aside aria-labelledby="details-heading" className="flex flex-col gap-4 rounded-md border border-foreground/20 p-4">
      <h2 id="details-heading" className="text-base font-semibold">
        {COPY.detailsHeading}
      </h2>
      {conversation !== null && (
        <dl>
          <Row label="Identificador">
            <code>{conversation.id}</code>
          </Row>
          <Row label="Flujo">
            {conversation.flowId} · versión {conversation.version}
          </Row>
          <Row label="Contacto">{conversation.contactId ?? 'Sin contacto'}</Row>
          <Row label="Estado">{STATUS_COPY[conversation.status]}</Row>
          <Row label="Resultado">{conversation.outcome ?? 'Sin resultado'}</Row>
          <Row label="Error">{conversation.error !== null ? `${conversation.error.code} en ${conversation.error.nodeId}` : 'Sin error'}</Row>
          {pending !== null && (
            <>
              <Row label="Intento de la pregunta">{pending.attempt}</Row>
              <Row label="Motivo del rechazo">{pending.reason ?? 'Ninguno'}</Row>
            </>
          )}
          <Row label="Coste">{formatCost(conversation.costUsd)}</Row>
          <Row label="Tope de coste alcanzado">{conversation.costLimitReached ? COPY.yes : COPY.no}</Row>
          <Row label="Revisión">{conversation.revision}</Row>
          <Row label="Creada">{formatDateTime(conversation.createdAt)}</Row>
          <Row label="Actualizada">{formatDateTime(conversation.updatedAt)}</Row>
          <Row label="Caduca">{conversation.expiresAt !== null ? formatDateTime(conversation.expiresAt) : 'No caduca'}</Row>
        </dl>
      )}
      <TechnicalActivity activity={activity} />
    </aside>
  );
}
