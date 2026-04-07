import { NextResponse } from "next/server"
import { getAuthUser, type AuthPayload } from "@/lib/auth"

export type RequireAuthResult =
  | { ok: true; user: AuthPayload }
  | { ok: false; response: NextResponse }

/**
 * Cookie session check for App Router API routes (defense in depth with `proxy.ts`).
 * @param routeLabel — e.g. `GET /api/dashboard/summary` for logs
 */
export async function requireAuthUser(routeLabel: string): Promise<RequireAuthResult> {
  let user: Awaited<ReturnType<typeof getAuthUser>>
  try {
    user = await getAuthUser()
  } catch (error) {
    console.error(`❌ API ERROR [${routeLabel}] auth/session verification:`, error)
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Session could not be verified. Check authentication configuration or try again.",
          code: "AUTH_VERIFICATION_FAILED",
        },
        { status: 503 }
      ),
    }
  }

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    }
  }

  return { ok: true, user }
}
