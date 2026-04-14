import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import { getAttendanceStats, listValidSessionsForReport } from "@/domain/attendance"
import { parseISTSessionDayRange, gymYmdFromInstant } from "@/lib/gym-datetime"
import { calcDuration, formatDuration, fromDate } from "@/lib/utils"

/**
 * GET: attendance statistics using VALID sessions only (checkout present, not auto-closed, member not deleted).
 */
export async function GET(request: Request) {
  const auth = await requireAuthUser("GET /api/attendance/reports")
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get("memberId")?.trim() || undefined
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    const sessionDayRange = parseISTSessionDayRange(startDate, endDate)
    const start = sessionDayRange?.gte
    const end = sessionDayRange?.lte

    const [validSessions, stats] = await Promise.all([
      listValidSessionsForReport(memberId, start, end),
      getAttendanceStats(memberId, start, end),
    ])

    const formattedSessions = validSessions.map((session) => {
      const minutes = session.checkOut
        ? Math.round(calcDuration(fromDate(session.checkIn), fromDate(session.checkOut)))
        : 0
      return {
        id: session.id,
        memberId: session.memberId,
        memberName: session.member.name,
        memberPhone: session.member.phone,
        date: gymYmdFromInstant(session.sessionDay),
        checkedInAt: session.checkIn.toISOString(),
        checkedOutAt: session.checkOut!.toISOString(),
        durationMinutes: minutes,
        durationFormatted: formatDuration(minutes),
        isValid: true,
      }
    })

    return NextResponse.json({
      success: true,
      stats: {
        validSessions: stats.validSessions,
        invalidSessions: stats.invalidSessions,
        totalMinutes: stats.totalMinutes,
        avgMinutes: stats.avgMinutes,
        avgDuration: `${stats.avgHours}h ${stats.avgRemainingMinutes}m`,
        avgDurationFormatted:
          stats.avgHours > 0
            ? `${stats.avgHours}h ${stats.avgRemainingMinutes}m`
            : `${stats.avgMinutes}m`,
      },
      sessions: formattedSessions,
      filters: {
        memberId: memberId ?? "all",
        startDate: startDate?.trim() || "all",
        endDate: endDate?.trim() || "all",
      },
    })
  } catch (error) {
    console.error("❌ Attendance Report Error:", error)
    return NextResponse.json(
      {
        error: "Failed to generate attendance report",
        code: "ATTENDANCE_REPORT_FAILED",
      },
      { status: 500 }
    )
  }
}
