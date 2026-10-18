import { connection } from 'next/server';
import { handlePublishFlow } from '@/server/bff/handlers';

export async function POST(request: Request, context: RouteContext<'/api/editor/flows/[flowId]/versions'>) {
  await connection();
  return handlePublishFlow(request, await context.params);
}
