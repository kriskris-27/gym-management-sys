import { prisma } from "../lib/prisma"

/**
 * Cleanup sessions older than specified days
 * Used for data retention policies
 */
export async function cleanupOldSessions(daysOld: number = 90) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  console.log(`[Attendance Cleanup] Cleaning up sessions older than ${daysOld} days`)

  try {
    const result = await prisma.attendanceSession.deleteMany({
      where: {
        sessionDay: {
          lt: cutoffDate,
        },
        checkOut: {
          not: null,
        },
      },
    })

    console.log(`[Attendance Cleanup] Deleted ${result.count} old sessions`)
    return result.count
  } catch (error) {
    console.error(`[Attendance Cleanup] Error cleaning up old sessions:`, error)
    throw error
  }
}
