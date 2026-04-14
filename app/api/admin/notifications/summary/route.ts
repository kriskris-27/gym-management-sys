import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requireAuthUser } from "@/lib/api-auth"

export async function GET() {
  const auth = await requireAuthUser("GET /api/admin/notifications/summary")
  if (!auth.ok) return auth.response

  try {
    const [sent, failed, skipped, total, recentRuns, latest] = await Promise.all([
      prisma.notificationLog.count({ where: { status: "SENT" } }),
      prisma.notificationLog.count({ where: { status: "FAILED" } }),
      prisma.notificationLog.count({ where: { status: "SKIPPED" } }),
      prisma.notificationLog.count(),
      prisma.notificationLog.groupBy({
        by: ["runId"],
        _count: { _all: true },
        where: { runId: { not: "" } },
        orderBy: { runId: "desc" },
        take: 20,
      }),
      prisma.notificationLog.findFirst({
        orderBy: { sentAt: "desc" },
        select: { sentAt: true, runId: true },
      }),
    ])

    const runIds = recentRuns.map((r) => r.runId)
    const runStatusRows =
      runIds.length === 0
        ? []
        : await prisma.notificationLog.groupBy({
            by: ["runId", "status"],
            where: { runId: { in: runIds } },
            _count: { _all: true },
          })

    const recentRunSummaries = recentRuns.map((run) => {
      const stats = { sent: 0, failed: 0, skipped: 0 }
      for (const row of runStatusRows) {
        if (row.runId !== run.runId) continue
        if (row.status === "SENT") stats.sent = row._count._all
        if (row.status === "FAILED") stats.failed = row._count._all
        if (row.status === "SKIPPED") stats.skipped = row._count._all
      }
      return {
        runId: run.runId,
        total: run._count._all,
        ...stats,
      }
    })

    return NextResponse.json({
      totals: {
        total,
        sent,
        failed,
        skipped,
        successRate: total > 0 ? Math.round((sent / total) * 100) : 0,
      },
      latestActivityAt: latest?.sentAt ?? null,
      latestRunId: latest?.runId ?? null,
      recentRuns: recentRunSummaries,
    })
  } catch (error) {
    console.error("GET /api/admin/notifications/summary failed:", error)
    return NextResponse.json({ error: "Failed to load notification summary" }, { status: 500 })
  }
}
