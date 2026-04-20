import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!
)

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment variables")
}

export const AUTH_COOKIE = "gym_token"

const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const MIN_SESSION_MAX_AGE_SECONDS = 60
const MAX_SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

/**
 * How long login stays valid (JWT `exp` and browser cookie `maxAge`), in seconds.
 * Set `AUTH_SESSION_MAX_AGE_SECONDS` in env; defaults to 7 days.
 */
export function getAuthSessionMaxAgeSeconds(): number {
  const raw = process.env.AUTH_SESSION_MAX_AGE_SECONDS?.trim()
  if (raw == null || raw === "") {
    return DEFAULT_SESSION_MAX_AGE_SECONDS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < MIN_SESSION_MAX_AGE_SECONDS) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS
  }
  return Math.min(parsed, MAX_SESSION_MAX_AGE_SECONDS)
}

export interface AuthPayload {
  userId: string
  username: string
}

/**
 * Sign a JWT for a user
 */
export async function signToken(payload: AuthPayload): Promise<string> {
  const maxAgeSeconds = getAuthSessionMaxAgeSeconds()
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(JWT_SECRET)
}

/**
 * Verify a JWT and return the payload or null
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as AuthPayload
  } catch {
    return null
  }
}

/**
 * Helper to get the authenticated user from the current request cookies (Server Components/Actions)
 */
export async function getAuthUser(): Promise<AuthPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE)?.value

  if (!token) return null

  return await verifyToken(token)
}

/**
 * Helper to logout / clear the auth cookie
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(AUTH_COOKIE)
}
