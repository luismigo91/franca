import { connection } from 'next/server';
import { handleTranscript } from '@/server/bff/handlers';

export async function GET(request: Request, context: RouteContext<'/api/conversations/[conversationId]/transcript'>) {
  await connection();
  return handleTranscript(request, await context.params);
}
