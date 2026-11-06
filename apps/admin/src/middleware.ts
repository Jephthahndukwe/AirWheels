import { type NextRequest, NextResponse } from 'next/server';

const OPEN = ['/login', '/accept-invite'];

/** Sends signed-out visitors to sign in. The API still checks every call; this only saves a round trip. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get('aw_admin_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|svg|jpg|ico)).*)'] };
