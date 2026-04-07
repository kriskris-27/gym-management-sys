import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { getUTCDateRange, calcDuration, formatDuration, nowUTC, fromDate } from "@/lib/utils"

/**
 * GET: Returns today's full attendance list for dashboard
 * Logic: Calculates live durations for members currently in the gym.
 * Stale session cleanup is handled by the nightly cron job (/api/cron/close-sessions).
 * Authentication: Handled by proxy middleware
 */
export async function GET() {
  const auth = await requireAuthUser("GET /api/attendance/today")
  if (!auth.ok) return auth.response

  // 1. TIME AUTHORITY - Use UTC as single source of truth
  const { todayUTC, tomorrowUTC } = getUTCDateRange()

  try {

    // 3. FETCH TODAY'S ATTENDANCE
    const records = await prisma.attendanceSession.findMany({
      where: {
        checkIn: {
          gte: todayUTC.toJSDate(),
          lt: tomorrowUTC.toJSDate(),
        },
      },
      select: {
        id: true,
        memberId: true,
        checkIn: true,
        checkOut: true,
        sessionDay: true,
        autoClosed: true,
        closeReason: true,
        member: {
          select: {
            name: true,
            phone: true,
            status: true,
          },
        },
      },
      orderBy: {
        checkIn: "asc",
      },
    })

    // 3. FILTER OUT DELETED MEMBERS
    const activeRecords = records.filter(
      (r: any) => r.member.status !== "DELETED"
    )

    // 4. COUNT UNIQUE MEMBERS PRESENT TODAY
    const totalPresent = new Set(activeRecords.map((r: any) => r.memberId)).size

    // 5. COUNT CURRENTLY INSIDE
    const currentlyInside = activeRecords.filter(
      (r: any) => !r.checkOut && !r.autoClosed
    ).length

    // 6. FORMAT RECORDS WITH LIVE DURATIONS
    const formattedRecords = activeRecords.map((record: any) => {
      const isOngoing = !record.checkOut && !record.autoClosed
      
      // Calculate duration for ongoing sessions
      let duration: number | null = null
      if (isOngoing) {
        duration = calcDuration(fromDate(record.checkIn), nowUTC())
      }

      return {
        id: record.id,
        memberId: record.memberId,
        memberName: record.member.name,
        memberPhone: record.member.phone,
        checkedInAt: record.checkIn.toISOString(),
        checkedOutAt: record.checkOut?.toISOString() || null,
        durationMinutes: duration,
        durationFormatted: isOngoing ? "ongoing" : formatDuration(duration || 0),
        autoClosed: record.autoClosed,
        closeReason: record.closeReason,
        isExpired: false, // Remove member.endDate reference
      }
    })

    return NextResponse.json(
      {
        date: todayUTC.toISODate(), // Server date string
        totalPresent,
        currentlyInside,
        records: formattedRecords,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    )

  } catch (error) {
    console.error("❌ Today Attendance Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
