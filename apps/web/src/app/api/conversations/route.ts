import { connection } from 'next/server';
import { handleCreateConversation, handleListConversations } from '@/server/bff/handlers';

export async function GET(request: Request) {
  await connection();
  return handleListConversations(request);
}

export async function POST(request: Request) {
  await connection();
  return handleCreateConversation(request);
}
