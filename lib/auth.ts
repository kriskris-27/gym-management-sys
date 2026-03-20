import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!
)

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment variables")
}

export const AUTH_COOKIE = "gym_token"

export interface AuthPayload {
  id: string
  username: string
}

/**
 * Sign a JWT for a user
 */
export async function signToken(payload: AuthPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET)
}

/**
 * Verify a JWT and return the payload or null
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as AuthPayload
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

  return await verifyToken(token)
}

/**
 * Helper to logout / clear the auth cookie
 */
export async function logout(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(AUTH_COOKIE)
}
