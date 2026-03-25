import { prisma } from "@/lib/prisma"
import { getISTDateRange, calcDuration } from "@/lib/utils"

const MAX_DURATION_MINUTES = 4 * 60 // 4 hours
const CLEANUP_BATCH_SIZE = 20

/**
 * Auto-close invalid sessions for a specific member
 * Used during scan operations to ensure data integrity
 */
export async function cleanupMemberSessions(memberId: string, now: Date = new Date()) {
  const { startOfTodayIST } = getISTDateRange()
  
  // Find all open sessions for this member
  const openSessions = await prisma.attendance.findMany({
    where: {
      memberId,
      checkedOutAt: null
    },
    orderBy: { checkedInAt: 'desc' }
  })

  const updates = []

  for (const session of openSessions) {
    // Rule 1: Previous day sessions must be closed
    if (session.date < startOfTodayIST) {
      updates.push({
        id: session.id,
        checkedOutAt: session.checkedInAt, // Close at check-in time
        durationMinutes: 0,
        autoClosed: true,
        autoCloseReason: 'PREVIOUS_DAY'
      })
      continue
    }

    // Rule 2: Sessions exceeding max duration must be closed
    const duration = calcDuration(session.checkedInAt, now)
    if (duration > MAX_DURATION_MINUTES) {
      updates.push({
        id: session.id,
        checkedOutAt: now,
        durationMinutes: duration,
        autoClosed: true,
        autoCloseReason: 'MAX_DURATION'
      })
    }
  }

  // Apply updates in batch
  if (updates.length > 0) {
    await Promise.all(
      updates.map(update => 
        prisma.attendance.update({
          where: { id: update.id },
          data: {
            checkedOutAt: update.checkedOutAt,
            durationMinutes: update.durationMinutes,
            autoClosed: update.autoClosed,
            autoCloseReason: update.autoCloseReason
          }
        })
      )
    )
  }

  return updates.length // Return number of cleaned sessions
}

/**
 * Batch cleanup of stale sessions (serverless-friendly)
 * Used during fetch operations to maintain data integrity
 */
export async function batchCleanupStaleSessions(now: Date = new Date()) {
  const { startOfTodayIST } = getISTDateRange()
  
  // Find limited batch of sessions needing cleanup
  const sessionsToClean = await prisma.attendance.findMany({
    where: {
      checkedOutAt: null,
      OR: [
        // Previous day sessions
        { date: { lt: startOfTodayIST } },
        // Sessions that would exceed max duration if closed now
        // Note: We can't filter by duration in query, so we'll check in code
      ]
    },
    take: CLEANUP_BATCH_SIZE,
    orderBy: { checkedInAt: 'asc' } // Oldest first
  })

  const updates = []

  for (const session of sessionsToClean) {
    // Previous day rule
    if (session.date < startOfTodayIST) {
      updates.push({
        id: session.id,
        checkedOutAt: session.checkedInAt,
        durationMinutes: 0,
        autoClosed: true,
        autoCloseReason: 'PREVIOUS_DAY'
      })
      continue
    }

    // Max duration rule
    const duration = calcDuration(session.checkedInAt, now)
    if (duration > MAX_DURATION_MINUTES) {
      updates.push({
        id: session.id,
        checkedOutAt: now,
        durationMinutes: duration,
        autoClosed: true,
        autoCloseReason: 'MAX_DURATION'
      })
    }
  }

  // Apply updates
  if (updates.length > 0) {
    await Promise.all(
      updates.map(update => 
        prisma.attendance.update({
          where: { id: update.id },
          data: {
            checkedOutAt: update.checkedOutAt,
            durationMinutes: update.durationMinutes,
            autoClosed: update.autoClosed,
            autoCloseReason: update.autoCloseReason
          }
        })
      )
    )
  }

  return updates.length
}

/**
 * Get only valid sessions for reporting
 * Excludes auto-closed sessions and open sessions
 */
export async function getValidSessions(
  memberId?: string,
  startDate?: Date,
  endDate?: Date
) {
  const where: {
    checkedOutAt: { not: null }
    autoClosed: boolean
    memberId?: string
    date?: {
      gte?: Date
      lte?: Date
    }
  } = {
    checkedOutAt: { not: null },
    autoClosed: false
  }

  if (memberId) {
    where.memberId = memberId
  }

  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = startDate
    if (endDate) where.date.lte = endDate
  }

  return await prisma.attendance.findMany({
    where,
    select: {
      id: true,
      memberId: true,
      date: true,
      checkedInAt: true,
      checkedOutAt: true,
      durationMinutes: true,
      member: {
        select: { name: true, phone: true }
      }
    },
    orderBy: { date: 'desc' }
  })
}

/**
 * Get session statistics (valid sessions only)
 */
export async function getSessionStats(
  memberId?: string,
  startDate?: Date,
  endDate?: Date
) {
  const validSessions = await getValidSessions(memberId, startDate, endDate)
  
  const totalSessions = validSessions.length
  const totalMinutes = validSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0)
  const avgMinutes = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0

  // Get invalid sessions count for reporting
  const invalidWhere: {
    OR: ({ autoClosed: boolean } | { checkedOutAt: { not: null } })[]
    memberId?: string
    date?: {
      gte?: Date
      lte?: Date
    }
  } = {
    OR: [
      { autoClosed: true },
      { checkedOutAt: null }
    ]
  }

  if (memberId) {
    invalidWhere.memberId = memberId
  }

  if (startDate || endDate) {
    invalidWhere.date = {}
    if (startDate) invalidWhere.date.gte = startDate
    if (endDate) invalidWhere.date.lte = endDate
  }

  const invalidSessions = await prisma.attendance.count({
    where: invalidWhere
  })

  return {
    validSessions: totalSessions,
    invalidSessions,
    totalMinutes,
    avgMinutes,
    avgHours: Math.floor(avgMinutes / 60),
    avgRemainingMinutes: avgMinutes % 60
  }
}
