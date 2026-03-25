import { prisma } from "../lib/prisma-optimized"
import { batchCleanupStaleSessions } from "../domain/attendance"

/**
 * Auto-close invalid sessions for a specific member
 * Used during scan operations to ensure data integrity
 */
export async function cleanupMemberSessions(memberId: string, now: Date = new Date()) {
  // Use domain function for cleanup
  return await batchCleanupStaleSessions(now)
}

/**
 * Batch cleanup of all stale sessions
 * Used by cron jobs and manual cleanup operations
 */
export async function batchCleanupAllSessions(now: Date = new Date()) {
  console.log(`[Attendance Cleanup] Starting batch cleanup`)
  
  try {
    const cleanedCount = await batchCleanupStaleSessions(now)
    console.log(`[Attendance Cleanup] Cleaned up ${cleanedCount} sessions`)
    return cleanedCount
  } catch (error) {
    console.error(`[Attendance Cleanup] Error during batch cleanup:`, error)
    throw error
  }
}

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
          lt: cutoffDate
        },
        checkOut: {
          not: null // Only delete completed sessions
        }
      }
    })
    
    console.log(`[Attendance Cleanup] Deleted ${result.count} old sessions`)
    return result.count
  } catch (error) {
    console.error(`[Attendance Cleanup] Error cleaning up old sessions:`, error)
    throw error
  }
}
