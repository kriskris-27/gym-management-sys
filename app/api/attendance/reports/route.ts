import { NextResponse } from "next/server"
import { getValidSessions, getSessionStats } from "@/lib/attendance-cleanup"
import { getISTDateRange } from "@/lib/utils"

/**
 * GET: Returns attendance statistics using only VALID sessions
 * Excludes auto-closed sessions and open sessions from calculations
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get('memberId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Parse date parameters
    const start = startDate ? new Date(startDate) : undefined
    const end = endDate ? new Date(endDate) : undefined

    // Get valid sessions only (excludes auto-closed and open sessions)
    const validSessions = await getValidSessions(
      memberId || undefined,
      start,
      end
    )

    // Get statistics for valid sessions only
    const stats = await getSessionStats(
      memberId || undefined,
      start,
      end
    )

    // Format sessions for response
    const formattedSessions = validSessions.map(session => ({
      id: session.id,
      memberId: session.memberId,
      memberName: session.member.name,
      memberPhone: session.member.phone,
      date: session.date.toISOString().split('T')[0],
      checkedInAt: session.checkedInAt.toISOString(),
      checkedOutAt: session.checkedOutAt.toISOString(),
      durationMinutes: session.durationMinutes,
      durationFormatted: formatDuration(session.durationMinutes || 0),
      isValid: true // All sessions from getValidSessions are valid
    }))

    return NextResponse.json({
      success: true,
      stats: {
        validSessions: stats.validSessions,
        invalidSessions: stats.invalidSessions,
        totalMinutes: stats.totalMinutes,
        avgMinutes: stats.avgMinutes,
        avgDuration: `${stats.avgHours}h ${stats.avgRemainingMinutes}m`,
        avgDurationFormatted: stats.avgHours > 0 
          ? `${stats.avgHours}h ${stats.avgRemainingMinutes}m`
          : `${stats.avgMinutes}m`
      },
      sessions: formattedSessions,
      filters: {
        memberId: memberId || 'all',
        startDate: start?.toISOString().split('T')[0] || 'all',
        endDate: end?.toISOString().split('T')[0] || 'all'
      }
    })

  } catch (error) {
    console.error("❌ Attendance Report Error:", error)
    return NextResponse.json({ 
      error: "Failed to generate attendance report",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}

function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  
  if (hrs === 0) return `${mins}min`
  if (mins === 0) return `${hrs}hr`
  return `${hrs}hr ${mins}min`
}
