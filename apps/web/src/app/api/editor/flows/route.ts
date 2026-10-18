import { connection } from 'next/server';
import { handleCreateFlow, handleListEditorFlows } from '@/server/bff/handlers';

export async function GET(request: Request) {
  await connection();
  return handleListEditorFlows(request);
}

export async function POST(request: Request) {
  await connection();
  return handleCreateFlow(request);
}
