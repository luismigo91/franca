import { reasonCopy } from '@/lib/chat/copy';

/** Aviso del motivo de una respuesta inválida, enlazado a la pregunta con `aria-describedby`. */
export function AnswerReason({ id, reason }: { id: string; reason: string }) {
  return (
    <p id={id} className="rounded border border-amber-700 bg-amber-700/10 px-3 py-2 text-sm dark:border-amber-400">
      {reasonCopy(reason)}
    </p>
  );
}
