import { asText } from '@/lib/editor/as-text';
import { problemPart, type Problem } from '@/lib/editor/issues-view';

export const SHAPE_NOTE_TEXT = 'Hay problemas de forma: el resto de comprobaciones llegará al corregirlos.';

/**
 * La lista de problemas y avisos del flujo, con salto al nodo o al panel del flujo (D6, D17). Los avisos van marcados con
 * «Aviso». Con problemas de forma, avisa de que el resto de comprobaciones llegará al corregirlos.
 */
export function ProblemsList({ problems, shapeProblems, onPick }: { problems: readonly Problem[]; shapeProblems: boolean; onPick: (problem: Problem) => void }) {
  return (
    <section aria-labelledby="problems-title" className="flex min-w-0 flex-col gap-2">
      <h2 id="problems-title" tabIndex={-1} className="text-lg font-semibold">
        Problemas
      </h2>
      {shapeProblems && <p className="text-sm">{SHAPE_NOTE_TEXT}</p>}
      {problems.length === 0 ? (
        <p className="text-sm opacity-70">Sin problemas.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {problems.map((problem, index) => (
            <li key={index}>
              <button
                type="button"
                className="w-full rounded-md border border-foreground/20 px-2 py-1 text-left text-sm [overflow-wrap:anywhere] hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
                onClick={() => onPick(problem)}
              >
                {problem.kind === 'warning' && <b>Aviso · </b>}
                {asText(problemPart(problem))}: {problem.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
