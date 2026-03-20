import jwt from "jsonwebtoken"
import { cookies } from "next/headers"

const JWT_SECRET = process.env.JWT_SECRET!

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment variables")
}

export const AUTH_COOKIE = "gym_session"

export interface AuthPayload {
  id: string
  username: string
}

/**
 * Sign a JWT for a user
 */
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" })
}

/**
 * Verify a JWT and return the payload or null
 */
export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload
  } catch (error) {
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

  return verifyToken(token)
}

/**
 * Helper to logout / clear the auth cookie
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(AUTH_COOKIE)
}
