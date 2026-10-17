import { connection } from 'next/server';
import { handleFlowVersion } from '@/server/bff/handlers';

export async function GET(request: Request, context: RouteContext<'/api/flows/[flowId]/versions/[version]'>) {
  await connection();
  return handleFlowVersion(request, await context.params);
}
