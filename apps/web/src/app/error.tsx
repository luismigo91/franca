'use client';

import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/chat/copy';

/** Límite de error del chat: un texto propio en español, nunca el mensaje del error. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">{COPY.errorBoundaryTitle}</h1>
      <Button className="self-start" onClick={reset}>
        {COPY.retry}
      </Button>
    </main>
  );
}
