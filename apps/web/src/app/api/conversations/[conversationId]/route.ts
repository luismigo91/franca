import { connection } from 'next/server';
import { handleDeleteConversation, handleGetConversation } from '@/server/bff/handlers';

export async function GET(request: Request, context: RouteContext<'/api/conversations/[conversationId]'>) {
  await connection();
  return handleGetConversation(request, await context.params);
}

export async function DELETE(request: Request, context: RouteContext<'/api/conversations/[conversationId]'>) {
  await connection();
  return handleDeleteConversation(request, await context.params);
}
