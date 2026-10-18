import { useId, type ReactNode } from 'react';
import type { FieldContext } from '@/components/editor/inspector/field-context';
import { problemsAt, type Problem } from '@/lib/editor/issues-view';

/** Ids y descripciones de un campo: sus problemas y avisos, y su error local, enlazados con `aria-describedby`. */
export function useFieldMeta(ctx: FieldContext, pointer: string, error?: string | null, exact = false) {
  const id = useId();
  const found = problemsAt(ctx.problems, pointer);
  const problems = exact ? found.filter((problem) => problem.path === pointer) : found;
  const describedBy = [problems.length > 0 ? `${id}-problems` : null, error ? `${id}-error` : null].filter((part) => part !== null).join(' ');
  return { id, problems, describedBy: describedBy === '' ? undefined : describedBy, problemsId: `${id}-problems`, errorId: `${id}-error` };
}

/** Los problemas, avisos y el error local de un campo, debajo de su control. */
export function FieldMessages({ problems, problemsId, error, errorId }: { problems: readonly Problem[]; problemsId: string; error?: string | null; errorId: string }) {
  return (
    <>
      {problems.length > 0 && (
        <ul id={problemsId} className="flex flex-col gap-0.5 text-xs">
          {problems.map((problem, index) => (
            <li key={index} className={problem.kind === 'issue' ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'}>
              {problem.kind === 'issue' ? 'Problema' : 'Aviso'}: {problem.message}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Contenedor de un campo: etiqueta, control y mensajes. */
export function FieldBox({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {htmlFor === undefined ? <span className="text-sm font-medium">{label}</span> : <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>}
      {children}
    </div>
  );
}

export const CONTROL_CLASS =
  'w-full min-w-0 rounded-md border border-foreground/30 bg-background px-2 py-1.5 text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground aria-[invalid=true]:border-red-700';
