import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getISTDateRange, calcDuration, formatDuration } from "@/lib/utils"
import { batchCleanupStaleSessions } from "@/lib/attendance-cleanup"

/**
 * GET: Returns today's full attendance list for dashboard
 * Logic: Calculates live durations for members currently in the gym.
 * Includes serverless-friendly batched cleanup.
 */
export async function GET() {
  const { startOfTodayIST, startOfTomorrowIST, istDateStr } = getISTDateRange()
  const now = new Date()

  try {
    // 1. SERVERLESS-FRIENDLY CLEANUP: Clean limited batch of stale sessions
    const cleanedCount = await batchCleanupStaleSessions(now)
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} stale attendance sessions`)
    }

    // 2. FETCH TODAY'S ATTENDANCE
    const records = await prisma.attendance.findMany({
      where: {
        checkedInAt: {
          gte: startOfTodayIST,
          lt: startOfTomorrowIST,
        },
      },
      select: {
        id: true,
        memberId: true,
        checkedInAt: true,
        checkedOutAt: true,
        durationMinutes: true,
        autoClosed: true,
        autoCloseReason: true,
        member: {
          select: {
            name: true,
            phone: true,
            endDate: true,
            status: true,
          },
        },
      },
      orderBy: {
        checkedInAt: "asc",
      },
    })

    // 3. FILTER OUT DELETED MEMBERS
    const activeRecords = records.filter(
      (r: any) => r.member.status !== "DELETED"
    )

    // 4. COUNT UNIQUE MEMBERS PRESENT TODAY
    const totalPresent = new Set(activeRecords.map((r: any) => r.memberId)).size

    // 5. COUNT MEMBERS CURRENTLY INSIDE (no checkout, not auto-closed)
    const currentlyInside = activeRecords.filter(
      (r: any) => !r.checkedOutAt && !r.autoClosed
    ).length

    // 6. FORMAT RECORDS WITH LIVE DURATIONS
    const formattedRecords = activeRecords.map((record: any) => {
      const isOngoing = !record.checkedOutAt && !record.autoClosed
      
      // Use stored duration for closed sessions, calculate live for ongoing
      let duration: number | null = record.durationMinutes
      if (isOngoing) {
        duration = calcDuration(record.checkedInAt, now)
      }

      return {
        id: record.id,
        memberId: record.memberId,
        memberName: record.member.name,
        memberPhone: record.member.phone,
        checkedInAt: record.checkedInAt.toISOString(),
        checkedOutAt: record.checkedOutAt?.toISOString() || null,
        durationMinutes: duration,
        durationFormatted: isOngoing ? "ongoing" : formatDuration(duration || 0),
        autoClosed: record.autoClosed,
        autoCloseReason: record.autoCloseReason,
        isExpired: now > new Date(record.member.endDate),
      }
    })

    return NextResponse.json(
      {
        date: istDateStr,
        totalPresent,
        currentlyInside,
        records: formattedRecords,
        cleanedSessions: cleanedCount, // For monitoring
      },
      {
        headers: {
          "Cache-Control": "s-maxage=30, stale-while-revalidate",
        },
      }
    )

  } catch (error) {
    console.error("❌ Today Attendance Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
