import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getISTDateRange, calcDuration, formatDuration } from "@/lib/utils"

/**
 * GET: Returns today's full attendance list for dashboard
 * Logic: Calculates live durations for members currently in the gym.
 */
export async function GET() {
  const { startOfTodayIST, startOfTomorrowIST, istDateStr } = getISTDateRange()
  const now = new Date()

  try {
    const records = await prisma.attendance.findMany({
      where: {
        checkedInAt: {
          gte: startOfTodayIST,
          lt: startOfTomorrowIST,
        },
      },
      select: {
        memberId: true,
        checkedInAt: true,
        checkedOutAt: true,
        durationMinutes: true,
        autoClosed: true,
        member: {
          select: {
            name: true,
            phone: true,
            endDate: true,
          },
        },
      },
      orderBy: {
        checkedInAt: "asc",
      },
    })

    // Count unique members present today
    const totalPresent = new Set(records.map((r) => r.memberId)).size

    const formattedRecords = records.map((record) => {
      const isOngoing = !record.checkedOutAt
      
      // Use stored duration for closed sessions, calculate live for ongoing
      let duration: number | null = record.durationMinutes
      if (isOngoing) {
        duration = calcDuration(record.checkedInAt, now)
      }

      return {
        memberId: record.memberId,
        memberName: record.member.name,
        memberPhone: record.member.phone,
        checkedInAt: record.checkedInAt.toISOString(),
        checkedOutAt: record.checkedOutAt?.toISOString() || null,
        durationMinutes: duration,
        durationFormatted: isOngoing ? "ongoing" : formatDuration(duration || 0),
        autoClosed: record.autoClosed,
        isExpired: now > new Date(record.member.endDate),
      }
    })

    return NextResponse.json(
      {
        date: istDateStr,
        totalPresent,
        records: formattedRecords,
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
