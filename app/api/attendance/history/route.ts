import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import { listSessionsForAttendanceHistory } from "@/domain/attendance"
import { parseISTSessionDayRange, gymYmdFromInstant } from "@/lib/gym-datetime"
import { calcDuration, formatDuration, fromDate } from "@/lib/utils"

/**
 * GET: full attendance for admin history (includes auto-closed and open sessions).
 * Query: startDate & endDate as YYYY-MM-DD (IST calendar), typically equal for one day.
 */
export async function GET(request: Request) {
  const auth = await requireAuthUser("GET /api/attendance/history")
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get("memberId")?.trim() || undefined
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    const sessionDayRange = parseISTSessionDayRange(startDate, endDate)
    const start = sessionDayRange?.gte
    const end = sessionDayRange?.lte

    const rows = await listSessionsForAttendanceHistory(memberId, start, end)

    const sessions = rows.map((session) => {
      const minutes =
        session.checkOut != null
          ? Math.round(calcDuration(fromDate(session.checkIn), fromDate(session.checkOut)))
          : null

      return {
        id: session.id,
        memberId: session.memberId,
        memberName: session.member.name,
        memberPhone: session.member.phone,
        date: gymYmdFromInstant(session.sessionDay),
        checkedInAt: session.checkIn.toISOString(),
        checkedOutAt: session.checkOut?.toISOString() ?? null,
        durationMinutes: minutes,
        durationFormatted: minutes != null ? formatDuration(minutes) : "—",
        autoClosed: session.autoClosed,
        status: session.status,
        closeReason: session.closeReason,
      }
    })

    return NextResponse.json(
      { success: true, sessions },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      }
    )
  } catch (error) {
    console.error("❌ Attendance history error:", error)
    return NextResponse.json(
      { error: "Failed to load attendance history", code: "ATTENDANCE_HISTORY_FAILED" },
      { status: 500 }
    )
  }
}
