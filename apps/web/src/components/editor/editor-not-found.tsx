import Link from 'next/link';
import { WEB_PAGES } from '@/config/endpoints';

/** El flujo no existe o está borrado, o su id no cumple el patrón de la spec (no llega a la API). */
export function EditorNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">Flujo no encontrado</h1>
      <p className="text-sm">Este flujo no existe o se ha borrado.</p>
      <Link href={WEB_PAGES.flows} className="self-start underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        Volver a los flujos
      </Link>
    </main>
  );
}
