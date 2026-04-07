import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { getTodaySessionDayJS, GYM_TIMEZONE } from "@/lib/gym-datetime"
import { calcDuration, formatDuration, nowUTC, fromDate } from "@/lib/utils"

/**
 * GET: today's attendance for dashboard — same IST calendar day as kiosk (`sessionDay`).
 */
export async function GET() {
  const auth = await requireAuthUser("GET /api/attendance/today")
  if (!auth.ok) return auth.response

  try {
    const sessionDay = getTodaySessionDayJS()
    const dateLabel = DateTime.fromJSDate(sessionDay, { zone: GYM_TIMEZONE }).toFormat("yyyy-MM-dd")

    const records = await prisma.attendanceSession.findMany({
      where: {
        sessionDay,
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

    const activeRecords = records.filter((r) => r.member.status !== "DELETED")

    const totalPresent = new Set(activeRecords.map((r) => r.memberId)).size

    const currentlyInside = activeRecords.filter((r) => !r.checkOut && !r.autoClosed).length

    const formattedRecords = activeRecords.map((record) => {
      const isOngoing = !record.checkOut && !record.autoClosed

      let duration: number | null = null
      if (isOngoing) {
        duration = calcDuration(fromDate(record.checkIn), nowUTC())
      } else if (record.checkOut) {
        duration = calcDuration(fromDate(record.checkIn), fromDate(record.checkOut))
      }

      return {
        id: record.id,
        memberId: record.memberId,
        memberName: record.member.name,
        memberPhone: record.member.phone,
        checkedInAt: record.checkIn.toISOString(),
        checkedOutAt: record.checkOut?.toISOString() ?? null,
        durationMinutes: duration,
        durationFormatted: isOngoing ? "ongoing" : formatDuration(duration ?? 0),
        autoClosed: record.autoClosed,
        closeReason: record.closeReason,
        isExpired: false,
      }
    })

    return NextResponse.json(
      {
        date: dateLabel,
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
    return NextResponse.json(
      { error: "Could not load today's attendance", code: "ATTENDANCE_TODAY_FAILED" },
      { status: 500 }
    )
  }
}
