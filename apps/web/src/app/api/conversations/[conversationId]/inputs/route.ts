import { connection } from 'next/server';
import { handleSendInput } from '@/server/bff/handlers';

export async function POST(request: Request, context: RouteContext<'/api/conversations/[conversationId]/inputs'>) {
  await connection();
  return handleSendInput(request, await context.params);
}
