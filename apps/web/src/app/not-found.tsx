import Link from 'next/link';
import { WEB_PAGES } from '@/config/endpoints';
import { COPY } from '@/lib/chat/copy';

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">{COPY.notFoundTitle}</h1>
      <p className="text-sm opacity-70">{COPY.notFoundBody}</p>
      <Link href={WEB_PAGES.home} className="self-start text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
        {COPY.backHome}
      </Link>
    </main>
  );
}
