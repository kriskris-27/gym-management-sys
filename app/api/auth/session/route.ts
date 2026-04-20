import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth"

/**
 * GET: Lightweight session probe (no DB). Admin shell should use this instead of
 * heavier endpoints so transient 5xx does not force a false logout.
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 })
  }
  return NextResponse.json(
    { ok: true, username: user.username },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    }
  )
}
