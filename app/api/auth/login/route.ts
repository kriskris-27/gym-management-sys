import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma-optimized"
import { signToken, AUTH_COOKIE } from "@/lib/auth"
import { LoginSchema } from "@/lib/validations"

/**
 * PHASE 1 Rate Limiting (In-memory Map)
 * Note: For distributed production (Vercel/Multiple Instances), use Upstash Redis (Phase 2).
 */
const rateLimitMap = new Map<string, { count: number; lastAttempt: number }>()
const LIMIT = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 Minute window

export async function POST(request: Request) {
  // Use X-Forwarded-For or a fallback for local testing
  const ip = request.headers.get("x-forwarded-for") || "127.0.0.1"
  const now = Date.now()

  // 1. RATE LIMITING CHECK (BEFORE DB Query)
  const rateLimit = rateLimitMap.get(ip)
  if (rateLimit) {
    if (now - rateLimit.lastAttempt < WINDOW_MS) {
      if (rateLimit.count >= LIMIT) {
        return NextResponse.json(
          { error: "Too many login attempts. Please try again in 15 minutes." },
          { status: 429 }
        )
      }
    } else {
      // Window expired, reset for this IP
      rateLimitMap.delete(ip)
    }
  }

  try {
    const body = await request.json()

    // 2. SCHEMA VALIDATION
    const validated = LoginSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 400 })
    }

    const { username, password } = validated.data

    // 3. DATABASE LOOKUP
    const user = await prisma.user.findUnique({
      where: { username },
    })

    // 4. TIMING ATTACK PROTECTION
    // Always run bcrypt comparison to prevent timing differences between existing/non-existing users.
    const DUMMY_HASH = "$2a$10$7EqJtq98hPqEX7fNZaFWoO/4c5c9e1u6KDAdAm8YGtSNYGGyRyvE2"

    const isValid = await bcrypt.compare(
      password,
      user?.password ?? DUMMY_HASH
    )

    if (!user || !isValid) {
      // Record failed attempt
      const current = rateLimitMap.get(ip) || { count: 0, lastAttempt: now }
      rateLimitMap.set(ip, { count: current.count + 1, lastAttempt: now })
      
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }

    // 5. SUCCESS → GENERATE JWT
    const token = await signToken({
      userId: user.id,
      username: user.username,
    })

    // 6. BUILD RESPONSE + SET HTTPONLY COOKIE
    const response = NextResponse.json({ 
      success: true, 
      username: user.username 
    }, { status: 200 })

    response.cookies.set({
      name: AUTH_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // Changed from "strict" to "lax" for better compatibility
      maxAge: 86400, // 24 hours in seconds
      path: "/",
    })

    // Success → Reset attempts for this IP
    rateLimitMap.delete(ip)

    return response

  } catch (error) {
    // Catch-all failure
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
}
