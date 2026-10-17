import type { ReactNode } from 'react';

type Tone = 'info' | 'error';

const TONES: Record<Tone, string> = {
  info: 'border-foreground/30 bg-foreground/5',
  error: 'border-red-700 bg-red-700/10 dark:border-red-400',
};

/** Aviso en un recuadro. `error` usa `role="alert"` (se anuncia al aparecer); `info` es una nota estática (`role="note"`): un `status` que se monta con su texto no se anuncia de forma fiable. */
export function Notice({ tone = 'info', id, children }: { tone?: Tone; id?: string; children: ReactNode }) {
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'note'} className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}
