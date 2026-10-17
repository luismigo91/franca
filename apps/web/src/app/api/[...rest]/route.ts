import { connection } from 'next/server';
import { handleNotFound } from '@/server/bff/handlers';

// Cualquier otra ruta o método de /api: 404 `not_found` sin llamar a la API.
export async function GET() {
  await connection();
  return handleNotFound();
}

export async function POST() {
  await connection();
  return handleNotFound();
}

export async function PUT() {
  await connection();
  return handleNotFound();
}

export async function PATCH() {
  await connection();
  return handleNotFound();
}

export async function DELETE() {
  await connection();
  return handleNotFound();
}

export async function OPTIONS() {
  await connection();
  return handleNotFound();
}
