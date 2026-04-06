import { NextResponse } from "next/server"
import { reconcileExpiredSubscriptions, syncMemberOperationalStatus } from "@/domain/subscription"

/**
 * GET: Reconcile subscription statuses against IST end-of-day coverage.
 * Security: Protected by CRON_SECRET when configured.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await reconcileExpiredSubscriptions()

    if (result.memberIds.length > 0) {
      await Promise.all(result.memberIds.map((memberId) => syncMemberOperationalStatus(memberId)))
    }

    return NextResponse.json({
      ok: true,
      examinedActiveSubscriptions: result.examined,
      expiredUpdated: result.expired,
      memberStatusesSynced: result.memberIds.length,
    })
  } catch (error) {
    console.error("❌ reconcile-subscriptions cron error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
