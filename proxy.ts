import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyToken, AUTH_COOKIE } from "./lib/auth"

/**
 * Public routes that do not require any authentication
 */
const PUBLIC_ROUTES = [
  "/login",
  "/checkin",
  "/api/auth/login",
  "/api/attendance/scan",
  "/api/cron/notify",
  "/api/cron/close-sessions",
]

/**
 * List of prefixes to always exclude from middleware protection (static assets, etc.)
 */
const EXCLUDE_PREFIXES = ["/_next", "/images", "/favicon.ico"]

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Skip middleware for exclude prefixes and public routes
  const isExcluded = EXCLUDE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isPublic = PUBLIC_ROUTES.includes(pathname)

  if (isExcluded || isPublic) {
    return NextResponse.next()
  }

  // 2. Read JWT from HttpOnly cookie
  const token = request.cookies.get(AUTH_COOKIE)?.value

  // 3. Unauthorized access check
  const payload = token ? await verifyToken(token) : null

  if (!payload || !payload.userId) {
    // API route protection → Hard 401 without leaking why
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Page protection → Redirect to /login
    const url = new URL("/login", request.url)
    return NextResponse.redirect(url)
  }

  // 4. Authorized - strip Authorization headers downstream for defense-in-depth
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete("Authorization")

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

/**
 * Next.js 16+ uses this file as the request proxy (do not add root `middleware.ts` — both files conflict).
 * `config` must be defined here so it can be parsed at compile time.
 */
export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/members",
    "/api/members/:path*",
    "/api/attendance/today",
    "/api/attendance/:path*",
    "/api/dashboard/:path*",
    "/api/payments/:path*",
    "/api/reports/:path*",
    "/api/settings/:path*",
    "/api/auth/logout",
  ],
}
