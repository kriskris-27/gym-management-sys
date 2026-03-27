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

/**
 * Get valid attendance sessions (non-deleted members, proper date ranges)
 * Used for reporting and analytics
 */
export async function getValidSessions(dateRange?: { start: Date; end: Date }) {
  console.log(`[Attendance Cleanup] Getting valid sessions`)
  
  try {
    const where = dateRange ? {
      sessionDay: {
        gte: dateRange.start,
        lte: dateRange.end
      }
    } : {}
    
    const sessions = await prisma.attendanceSession.findMany({
      where: {
        ...where,
        member: {
          status: 'ACTIVE'
        }
      },
      include: {
        member: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        }
      },
      orderBy: {
        checkIn: 'desc'
      }
    })
    
    console.log(`[Attendance Cleanup] Found ${sessions.length} valid sessions`)
    return sessions
  } catch (error) {
    console.error(`[Attendance Cleanup] Error getting valid sessions:`, error)
    throw error
  }
}

/**
 * Get session statistics for reporting
 * Used for dashboard and analytics
 */
export async function getSessionStats(dateRange?: { start: Date; end: Date }) {
  console.log(`[Attendance Cleanup] Getting session stats`)
  
  try {
    const where = dateRange ? {
      sessionDay: {
        gte: dateRange.start,
        lte: dateRange.end
      }
    } : {}
    
    const stats = await prisma.attendanceSession.groupBy({
      by: ['status'],
      where: {
        ...where,
        member: {
          status: 'ACTIVE'
        }
      },
      _count: {
        id: true
      }
    })
    
    const totalSessions = await prisma.attendanceSession.count({
      where: {
        ...where,
        member: {
          status: 'ACTIVE'
        }
      }
    })
    
    const result = {
      total: totalSessions,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = stat._count.id
        return acc
      }, {} as Record<string, number>)
    }
    
    console.log(`[Attendance Cleanup] Session stats:`, result)
    return result
  } catch (error) {
    console.error(`[Attendance Cleanup] Error getting session stats:`, error)
    throw error
  }
}
