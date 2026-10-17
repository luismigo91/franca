import { COPY } from '@/lib/chat/copy';

/**
 * Texto plano (D14): un nodo de texto de React con `white-space: pre-wrap` (saltos de línea y espacios tal cual, como
 * ` Ana `) y `overflow-wrap: anywhere` para 320 px. Nada de HTML, Markdown ni enlaces automáticos. Una respuesta vacía
 * es una burbuja con la marca visual «(vacía)» en `aria-hidden` y el nombre accesible «Respuesta vacía»: es
 * presentación, el texto enviado no cambia.
 */
export function MessageText({ text }: { text: string }) {
  if (text === '') {
    return (
      <p>
        <span className="sr-only">{COPY.emptyAnswerName}</span>
        <span aria-hidden="true" className="italic opacity-70">
          {COPY.emptyAnswer}
        </span>
      </p>
    );
  }
  return <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>;
}
