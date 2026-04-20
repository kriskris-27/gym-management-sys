import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifyToken, AUTH_COOKIE } from "./lib/auth"


const PUBLIC_ROUTES = [
  "/login",
  "/checkin",
  "/api/auth/login",
  "/api/attendance/scan",
  "/api/cron/notify",
  "/api/cron/close-sessions",
]


const EXCLUDE_PREFIXES = ["/_next", "/images", "/favicon.ico"]

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1. Skip middleware for exclude prefixes and public routes
  const isExcluded = EXCLUDE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isPublic = PUBLIC_ROUTES.includes(pathname)

  if (isExcluded || isPublic) {
    return NextResponse.next()
  }


  const token = request.cookies.get(AUTH_COOKIE)?.value


  const payload = token ? await verifyToken(token) : null

  if (!payload || !payload.userId) {
    // API route protection → Hard 401 without leaking why
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }


    const url = new URL("/login", request.url)
    return NextResponse.redirect(url)
  }


  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete("Authorization")

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}


export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/members",
    "/api/members/:path*",
    "/api/attendance/today",
    "/api/attendance/:path*",
    "/api/dashboard/:path*",
    "/api/payments/:path*",
    "/api/reports/:path*",
    "/api/settings/:path*",
    "/api/auth/logout",
    "/api/auth/session",
  ],
}
