import { connection } from 'next/server';
import { handleDeleteFlow, handleGetFlow, handleUpdateFlow } from '@/server/bff/handlers';

export async function GET(request: Request, context: RouteContext<'/api/editor/flows/[flowId]'>) {
  await connection();
  return handleGetFlow(request, await context.params);
}

export async function PUT(request: Request, context: RouteContext<'/api/editor/flows/[flowId]'>) {
  await connection();
  return handleUpdateFlow(request, await context.params);
}

export async function DELETE(request: Request, context: RouteContext<'/api/editor/flows/[flowId]'>) {
  await connection();
  return handleDeleteFlow(request, await context.params);
}
