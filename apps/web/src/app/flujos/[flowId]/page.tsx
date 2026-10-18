import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EditorLoading } from '@/components/editor/editor-loading';
import { EditorNotFound } from '@/components/editor/editor-not-found';
import { EditorScreen } from '@/components/editor/editor-screen';
import { isFlowId } from '@/server/ids';

export const metadata: Metadata = { title: 'Editor de flujos' };

// Sin `generateStaticParams`, `params` son datos de la petición y van dentro de <Suspense> (Cache Components, D1).
async function EditorRoute({ params }: { params: PageProps<'/flujos/[flowId]'>['params'] }) {
  const { flowId } = await params;
  // Un id que no cumple el patrón de la spec no llega a ninguna llamada.
  if (!isFlowId(flowId)) return <EditorNotFound />;
  return <EditorScreen key={flowId} flowId={flowId} />;
}

export default function Page({ params }: PageProps<'/flujos/[flowId]'>) {
  return (
    <Suspense fallback={<EditorLoading />}>
      <EditorRoute params={params} />
    </Suspense>
  );
}
