import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkFrontier } from '@/server/frontier';

/**
 * Frontera local de la web (D2). Sin `matcher`: corre en toda petición, también la de un estático. La decisión
 * vive en `checkFrontier`, una función pura que se prueba sin Next.
 */
export function proxy(request: NextRequest): NextResponse {
  const decision = checkFrontier({ method: request.method, headers: request.headers, pathname: request.nextUrl.pathname });
  if (!decision.allowed) return new NextResponse(decision.body, { status: decision.status, headers: decision.headers });
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(decision.headers)) response.headers.set(name, value);
  return response;
}
