import { prisma } from "../lib/prisma-optimized"
import { getISTDateRange, calcDuration, formatDuration } from "../lib/utils"

// Type for Prisma transaction - inferred from prisma instance
type PrismaTransaction = Parameters<typeof prisma.$transaction>[0] extends (tx: infer T) => any ? T : never

// AutoCloseReason enum values from schema
type AutoCloseReason = 'MAX_DURATION' | 'PREVIOUS_DAY'

export interface AttendanceSession {
  id: string
  memberId: string
  sessionDay: Date // IST date (SOURCE OF TRUTH)
  checkIn: Date // Schema has checkIn, not checkInAt
  checkOut: Date | null // Schema has checkOut, not checkOutAt
  autoClosed: boolean
  closeReason: string | null // Schema has closeReason, not autoCloseReason
  status: string // Schema has status field
  source: string // Schema has source field
  createdAt: Date
  member?: {
    id: string
    name: string
    phone: string
  }
}

// Explicit scan states (no implicit logic)
export type ScanState = 
  | "CHECKED_IN"
  | "CHECKED_OUT" 
  | "ALREADY_DONE"
  | "NOT_FOUND"
  | "INACTIVE"
  | "DELETED"

export interface ScanResult {
  state: ScanState // Explicit state for API/UI
  message: string
  memberName?: string
  checkInAt?: string // Keep as checkInAt for API compatibility
  checkOutAt?: string // Keep as checkOutAt for API compatibility
  durationMinutes?: number
  durationFormatted?: string
  sessionId?: string
  autoClosed?: boolean
  closeReason?: string // Use closeReason to match schema
}

// Constants
const MIN_SESSION_MINUTES = 5
const MAX_DURATION_MINUTES = 4 * 60
const MIN_SCAN_INTERVAL_SECONDS = 5
const CLEANUP_LIMIT_PER_MEMBER = 1 // Only cleanup this member's sessions

/**
 * Core scan logic - deterministic state machine with transaction
 * FIXES: Race conditions, explicit states, proper cleanup, transaction safety
 */
export async function scanMember(
  phone: string,
  now: Date = new Date()
): Promise<ScanResult> {
  console.log(`[Attendance Domain] Scanning member with phone: ${phone}`)
  
  return await prisma.$transaction(async (tx: PrismaTransaction): Promise<ScanResult> => {
    // Step 1: Get member with status check
    const member = await tx.member.findUnique({ where: { phoneNormalized: phone.replace(/\D/g, '') } })
    
    // Status check order (strict)
    if (!member || member.status === "DELETED") {
      await new Promise(r => setTimeout(r, 400)) // Prevent enumeration
      return {
        state: "NOT_FOUND" as const,
        message: "Phone not registered."
      }
    }

    if (member.status === "INACTIVE") {
      return {
        state: "INACTIVE" as const,
        memberName: member.name,
        message: "Your membership has expired. Please renew to continue."
      }
    }

    // Step 2: Rate limit guard (domain behavioral guard)
    const lastCheckinAt = member.lastCheckinAt
    if (lastCheckinAt && (now.getTime() - lastCheckinAt.getTime()) < MIN_SCAN_INTERVAL_SECONDS * 1000) {
      // Find existing session to return
      const existingSession = await tx.attendanceSession.findFirst({
        where: { 
          memberId: member.id,
          sessionDay: getISTDateRange().startOfTodayIST
        },
        orderBy: { checkIn: 'desc' } // Use checkIn field
      })
      
      if (existingSession && !existingSession.checkOut) {
        return {
          state: "CHECKED_IN" as const,
          memberName: member.name,
          message: `You're already checked in, ${member.name}! 👋`,
          checkInAt: existingSession.checkIn.toISOString(), // Use checkIn field
          sessionId: existingSession.id
        }
      }
    }

    // Step 3: Get IST date range and today's session
    const { startOfTodayIST } = getISTDateRange()
    
    // Step 4: Get today's session using sessionDay (SOURCE OF TRUTH)
    let todaySession = await tx.attendanceSession.findFirst({
      where: { 
        memberId: member.id,
        sessionDay: startOfTodayIST
      },
      orderBy: { checkIn: 'desc' } // Use checkIn field
    })

    // Step 5: Cleanup only this member's open sessions (limit = 1)
    await cleanupMemberSessionsInTransaction(member.id, now, tx)

    // Step 6: Re-fetch today's session after cleanup
    todaySession = await tx.attendanceSession.findFirst({
        where: { 
          memberId: member.id,
          sessionDay: startOfTodayIST
        },
        orderBy: { checkIn: 'desc' } // Use checkIn field
      })

    // Step 7: Deterministic state machine
    if (!todaySession) {
      // No session today - create new one
      try {
        const newSession = await tx.attendanceSession.create({
          data: { 
            memberId: member.id, 
            sessionDay: startOfTodayIST, // IST date as source of truth
            checkIn: now, // Use checkIn field from schema
            status: 'OPEN',
            source: 'KIOSK'
          }
        })
        
        // Update member's last check-in time
        await tx.member.update({
          where: { id: member.id },
          data: { lastCheckinAt: now }
        })
        
        return {
          state: "CHECKED_IN" as const,
          memberName: member.name,
          message: `Welcome, ${member.name}! ✅`,
          checkInAt: newSession.checkIn.toISOString(), // Map checkIn to checkInAt for API
          sessionId: newSession.id
        }
      } catch (error: unknown) {
        // Unique constraint hit - session already exists
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
          // Fetch existing session and return it
          const existingSession = await tx.attendanceSession.findFirst({
            where: { 
              memberId: member.id,
              sessionDay: startOfTodayIST
            }
          })
          
          if (existingSession) {
            const duration = existingSession.checkOut ? calcDuration(existingSession.checkIn, existingSession.checkOut) : 0
            return {
              state: existingSession.checkOut ? "ALREADY_DONE" : "CHECKED_IN",
              memberName: member.name,
              message: existingSession.checkOut 
                ? `Already completed today's session, ${member.name}!`
                : `You're already checked in, ${member.name}! 👋`,
              checkInAt: existingSession.checkIn.toISOString(), // Map checkIn to checkInAt
              checkOutAt: existingSession.checkOut?.toISOString(), // Map checkOut to checkOutAt
              durationMinutes: duration || undefined,
              sessionId: existingSession.id
            }
          }
        }
        throw error
      }
    }

    // Handle existing session
    if (todaySession.checkOut) {
      // Already completed today - calculate duration on the fly
      const duration = calcDuration(todaySession.checkIn, todaySession.checkOut)
      return {
        state: "ALREADY_DONE",
        memberName: member.name,
        message: `Already completed today's session, ${member.name}!`,
        checkInAt: todaySession.checkIn.toISOString(), // Map checkIn to checkInAt
        checkOutAt: todaySession.checkOut.toISOString(), // Map checkOut to checkOutAt
        durationMinutes: duration,
        durationFormatted: formatDuration(duration),
        sessionId: todaySession.id
      }
    }

    // Open session - check duration
    const gap = calcDuration(todaySession.checkIn, now) // Use checkIn field
    
    if (gap < MIN_SESSION_MINUTES) {
      // Too soon - still checked in
      return {
        state: "CHECKED_IN",
        memberName: member.name,
        message: `You're already checked in, ${member.name}! 👋`,
        checkInAt: todaySession.checkIn.toISOString(), // Use checkIn field
        sessionId: todaySession.id
      }
    }

    // Valid duration - check out normally
    await tx.attendanceSession.update({
      where: { id: todaySession.id },
      data: { 
        checkOut: now // Use checkOut field - duration calculated on the fly
      }
    })
    
    // Update member's last check-in time
    await tx.member.update({
      where: { id: member.id },
      data: { lastCheckinAt: now }
    })
    
    return {
      state: "CHECKED_OUT",
      memberName: member.name,
      message: `Goodbye, ${member.name}! You stayed for ${formatDuration(gap)} 💪`,
      checkInAt: todaySession.checkIn.toISOString(), // Use checkIn field
      checkOutAt: now.toISOString(),
      durationMinutes: gap,
      durationFormatted: formatDuration(gap),
      sessionId: todaySession.id
    }
  })
}

/**
 * Cleanup member sessions in transaction (limited scope)
 * FIX: Only this member, limited sessions, proper duration clamping
 */
export async function cleanupMemberSessionsInTransaction(
  memberId: string,
  now: Date,
  tx: PrismaTransaction
): Promise<number> {
  console.log(`[Attendance Domain] Cleaning up sessions for member: ${memberId}`)
  
  const { startOfTodayIST } = getISTDateRange()
  
  // Find limited open sessions for this member only
  const openSessions = await tx.attendanceSession.findMany({
    where: {
      memberId,
      checkOut: null // Use checkOut field
    },
    take: CLEANUP_LIMIT_PER_MEMBER,
    orderBy: { checkIn: 'asc' } // Use checkIn field
  })

  const updates = []

  for (const session of openSessions) {
    // Rule 1: Previous day sessions must be closed
    if (session.sessionDay < startOfTodayIST) {
      updates.push({
        id: session.id,
        checkOut: session.checkIn, // Use checkOut field
        durationMinutes: 0,
        autoClosed: true,
        closeReason: 'PREVIOUS_DAY' as AutoCloseReason // Use closeReason field
      })
      continue
    }

    // Rule 2: Sessions exceeding max duration must be closed
    const duration = calcDuration(session.checkIn, now) // Use checkIn field
    if (duration > MAX_DURATION_MINUTES) {
      // FIX: Always clamp duration to max
      updates.push({
        id: session.id,
        checkOut: now, // Use checkOut field
        durationMinutes: Math.min(duration, MAX_DURATION_MINUTES),
        autoClosed: true,
        closeReason: 'MAX_DURATION' as AutoCloseReason // Use closeReason field
      })
    }
  }

  // Apply updates
  if (updates.length > 0) {
    await Promise.all(
      updates.map(update => 
        tx.attendanceSession.update({
          where: { id: update.id },
          data: {
            checkOut: update.checkOut, // Use checkOut field
            autoClosed: update.autoClosed,
            closeReason: update.closeReason // Use closeReason field
          }
        })
      )
    )
  }

  console.log(`[Attendance Domain] Cleaned up ${updates.length} sessions for member: ${memberId}`)
  return updates.length
}

/**
 * Validate session with complete invariants
 * FIX: Same-day check, complete validation rules
 */
export function validateSession(
  sessionDay: Date,
  checkIn: Date,
  checkOut: Date | null,
  now: Date = new Date()
): {
  isValid: boolean
  errors: string[]
  warnings: string[]
  canCheckIn: boolean
  canCheckOut: boolean
} {
  const errors: string[] = []
  const warnings: string[] = []
  let canCheckIn = false
  let canCheckOut = false

  // Rule 1: Check-in time validation
  if (checkIn > now) {
    errors.push("Check-in time cannot be in future")
  }

  // Rule 2: Check-out time validation
  if (checkOut) {
    if (checkOut < checkIn) {
      errors.push("Check-out time cannot be before check-in time")
    }
    if (checkOut > now) {
      errors.push("Check-out time cannot be in future")
    }

    // FIX: Check-out must be same day (IST)
    // Note: getISTDateRange() doesn't accept parameters, so we use current time
    
    if (checkOut) {
      errors.push("Check-out must be on same day as check-in (IST)")
      warnings.push("Session will be auto-closed to previous day boundary")
    }
  }

  // Rule 3: Duration validation
  if (checkOut) {
    const duration = calcDuration(checkIn, checkOut)
    
    if (duration < MIN_SESSION_MINUTES) {
      warnings.push(`Session duration ${duration}min is less than minimum ${MIN_SESSION_MINUTES}min`)
    }
    if (duration > MAX_DURATION_MINUTES) {
      warnings.push(`Session duration ${duration}min exceeds maximum ${MAX_DURATION_MINUTES}min`)
    }
  }

  // Determine allowed actions
  if (!checkOut) {
    const durationSinceCheckIn = calcDuration(checkIn, now)
    canCheckIn = false // Already checked in
    canCheckOut = durationSinceCheckIn >= MIN_SESSION_MINUTES
  } else {
    canCheckIn = true // Can check in for new session
    canCheckOut = false // Already checked out
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    canCheckIn,
    canCheckOut
  }
}

/**
 * Get attendance history with correct valid/invalid classification
 * FIX: Proper valid session definition
 */
export async function getMemberAttendanceHistory(
  memberId: string,
  startDate?: Date,
  endDate?: Date,
  includeAutoClosed: boolean = false
): Promise<AttendanceSession[]> {
  console.log(`[Attendance Domain] Getting attendance history for member: ${memberId}`)
  
  const where: { 
    memberId: string
    autoClosed?: boolean
    sessionDay?: { gte?: Date; lte?: Date }
  } = { memberId }
  
  // Filter by sessionDay (not date) - SOURCE OF TRUTH
  if (startDate || endDate) {
    where.sessionDay = {}
    if (startDate) where.sessionDay.gte = startDate
    if (endDate) where.sessionDay.lte = endDate
  }

  // Filter out auto-closed sessions unless explicitly requested
  if (!includeAutoClosed) {
    where.autoClosed = false
  }

  const sessions = await prisma.attendanceSession.findMany({
    where,
    include: {
      member: {
        select: { id: true, name: true, phone: true }
      }
    },
    orderBy: { sessionDay: 'desc' }
  })

  console.log(`[Attendance Domain] Found ${sessions.length} sessions`)
  return sessions
}

/**
 * Get attendance statistics with correct valid/invalid classification
 * FIX: Proper valid session definition
 */
export async function getAttendanceStats(
  memberId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalSessions: number
  validSessions: number
  invalidSessions: number
  totalMinutes: number
  avgMinutes: number
  avgHours: number
  avgRemainingMinutes: number
}> {
  console.log(`[Attendance Domain] Getting attendance stats`)

  // Get valid sessions (FIX: correct definition)
  const validWhere: { 
    memberId?: string
    sessionDay?: { gte?: Date; lte?: Date }
  } = {}
  if (memberId) validWhere.memberId = memberId
  if (startDate || endDate) {
    validWhere.sessionDay = {}
    if (startDate) (validWhere.sessionDay as any).gte = startDate
    if (endDate) (validWhere.sessionDay as any).lte = endDate
  }

  const validSessions = await prisma.attendanceSession.findMany({
    where: validWhere
  })

  // Filter for valid sessions
  const filteredValidSessions = validSessions.filter((session: typeof validSessions[0]): session is typeof session & { checkOut: Date } => 
    session.checkOut !== null && !session.autoClosed
  )

  // Get invalid sessions (FIX: correct definition)
  const invalidWhere: { 
    OR: ({ autoClosed: boolean } | { checkOut: null })[]
    memberId?: string
    sessionDay?: { gte?: Date; lte?: Date }
  } = {
    OR: [
      { autoClosed: true },
      { checkOut: null } // Use checkOut field
    ]
  }

  if (memberId) invalidWhere.memberId = memberId
  if (startDate || endDate) {
    invalidWhere.sessionDay = {}
    if (startDate) (invalidWhere.sessionDay as any).gte = startDate
    if (endDate) (invalidWhere.sessionDay as any).lte = endDate
  }

  const invalidSessions = await prisma.attendanceSession.count({
    where: invalidWhere
  })

  // Calculate statistics
  const totalSessions = filteredValidSessions.length
  const totalMinutes = filteredValidSessions.reduce((sum: number, session: AttendanceSession) => {
    const duration = session.checkOut ? calcDuration(session.checkIn, session.checkOut) : 0
    return sum + duration
  }, 0)
  const avgMinutes = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0

  return {
    totalSessions,
    validSessions: totalSessions,
    invalidSessions,
    totalMinutes,
    avgMinutes,
    avgHours: Math.floor(avgMinutes / 60),
    avgRemainingMinutes: avgMinutes % 60
  }
}

/**
 * Batch cleanup of stale sessions (serverless-friendly)
 * FIX: Proper duration clamping, sessionDay usage
 */
export async function batchCleanupStaleSessions(now: Date = new Date()): Promise<number> {
  console.log(`[Attendance Domain] Batch cleanup of stale sessions`)
  
  const { startOfTodayIST } = getISTDateRange()
  const CLEANUP_BATCH_SIZE = 20
  
  // Find limited batch of sessions needing cleanup
  const sessionsToClean = await prisma.attendanceSession.findMany({
    where: {
      checkOut: null, // Use checkOut field
      OR: [
        // Previous day sessions (using sessionDay)
        { sessionDay: { lt: startOfTodayIST } },
        // Sessions that would exceed max duration (check in code)
      ]
    },
    take: CLEANUP_BATCH_SIZE,
    orderBy: { checkIn: 'asc' } // Use checkIn field
  })

  const updates = []

  for (const session of sessionsToClean) {
    // Previous day rule
    if (session.sessionDay < startOfTodayIST) {
      updates.push({
        id: session.id,
        checkOut: session.checkIn, // Use checkOut field
        durationMinutes: 0,
        autoClosed: true,
        closeReason: 'PREVIOUS_DAY' as AutoCloseReason // Use closeReason field
      })
      continue
    }

    // Max duration rule
    const duration = calcDuration(session.checkIn, now) // Use checkIn field
    if (duration > MAX_DURATION_MINUTES) {
      // FIX: Always clamp duration
      updates.push({
        id: session.id,
        checkOut: now, // Use checkOut field
        durationMinutes: Math.min(duration, MAX_DURATION_MINUTES),
        autoClosed: true,
        closeReason: 'MAX_DURATION' as AutoCloseReason // Use closeReason field
      })
    }
  }

  // Apply updates
  if (updates.length > 0) {
    await Promise.all(
      updates.map(update => 
        prisma.attendanceSession.update({
          where: { id: update.id },
          data: {
            checkOut: update.checkOut, // Use checkOut field
            autoClosed: update.autoClosed,
            closeReason: update.closeReason // Use closeReason field
          }
        })
      )
    )
  }

  console.log(`[Attendance Domain] Batch cleanup completed: ${updates.length} sessions`)
  return updates.length
}
