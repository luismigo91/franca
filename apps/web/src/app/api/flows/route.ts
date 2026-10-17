import { connection } from 'next/server';
import { handleListFlows } from '@/server/bff/handlers';

export async function GET(request: Request) {
  await connection();
  return handleListFlows(request);
}
