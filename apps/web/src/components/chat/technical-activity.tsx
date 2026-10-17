import { COPY } from '@/lib/chat/copy';
import { formatCost, plural } from '@/lib/chat/format';
import type { ActivityItem } from '@/lib/chat/transcript-view';

function describe(item: ActivityItem): string {
  switch (item.type) {
    case 'http':
      return `HTTP en ${item.nodeId}: ${plural(item.attempts, 'intento', 'intentos')}, estado ${item.status ?? 'sin respuesta'}, error ${item.error ?? 'ninguno'}`;
    case 'llm':
      return `LLM en ${item.nodeId}: ${plural(item.turns, 'turno', 'turnos')}, coste ${formatCost(item.costUsd)}, motivo ${item.reason ?? 'ninguno'}`;
    case 'error':
      return `Error en ${item.nodeId}: ${item.code}`;
  }
}

/** La actividad técnica en orden: es información para quien prueba el flujo, no parte de la conversación. Nunca el `message` de un `error`. */
export function TechnicalActivity({ activity }: { activity: ActivityItem[] }) {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      <h3 id="activity-heading" className="text-sm font-semibold">
        {COPY.activityHeading}
      </h3>
      {activity.length === 0 ? (
        <p className="text-sm opacity-70">{COPY.noActivity}</p>
      ) : (
        <ol className="flex flex-col gap-1 text-sm [overflow-wrap:anywhere]">
          {activity.map((item, index) => (
            <li key={index}>{describe(item)}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
