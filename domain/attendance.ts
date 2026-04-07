import { prisma } from "../lib/prisma"
import type { Prisma } from "@prisma/client"
import { calcDuration, formatDuration, fromDate, nowUTC } from "../lib/utils"
import { DateTime } from "luxon"
import {
  formatMemberDate,
  getTodaySessionDayJS,
  isMembershipEndPast,
  isMembershipStartInFutureIST,
} from "../lib/gym-datetime"

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
const MIN_SESSION_MINUTES = 0.17 // ~10 seconds for testing (0.17 minutes)
const MAX_DURATION_MINUTES = 4 * 60
const DEFAULT_CLOSING_HOUR = 22 // 10 PM IST — used for realistic auto-close checkOut
const MIN_SCAN_INTERVAL_SECONDS = 5
const CLEANUP_LIMIT_PER_MEMBER = 1 // Only cleanup this member's sessions

/**
 * Core scan logic - deterministic state machine with transaction
 * FIXES: Race conditions, explicit states, proper cleanup, transaction safety
 */
export async function scanMember(
  phone: string,
  nowJS: Date = new Date()
): Promise<ScanResult> {
  const now = fromDate(nowJS)
  console.log(`[Attendance Domain] Scanning member with phone: ${phone} at ${now.toISO()}`)

  
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
        message: "Your membership has been deactivated. Please contact the front desk."
      }
    }

    // Step 1.5: PRODUCTION GUARD: Check for valid active subscription
    // Even if member status is ACTIVE, they must have a non-expired plan
    const { getActiveSubscription } = await import("./subscription")
    const activeSub = await getActiveSubscription(member.id)

    if (!activeSub) {
      const activeRows = await tx.subscription.findMany({
        where: { memberId: member.id, status: "ACTIVE" },
        orderBy: { startDate: "asc" },
      })
      const future = activeRows.find(
        (s) =>
          isMembershipStartInFutureIST(s.startDate) && !isMembershipEndPast(s.endDate)
      )
      if (future) {
        return {
          state: "INACTIVE" as const,
          memberName: member.name,
          message: `Your membership starts on ${formatMemberDate(future.startDate)}. Check-in opens on that day — see the front desk if you need help.`,
        }
      }
      return {
        state: "INACTIVE" as const,
        memberName: member.name,
        message: "No active plan found. Please renew your membership to enter.",
      }
    }


    // Step 2: Rate limit guard (domain behavioral guard)
    // FIX: Check for potential check-out BEFORE applying rate limit
    const lastCheckinAt = member.lastCheckinAt ? fromDate(member.lastCheckinAt) : null
    
    if (lastCheckinAt && now.diff(lastCheckinAt, 'seconds').seconds < MIN_SCAN_INTERVAL_SECONDS) {
      // Check if there's an open session that might need check-out
      const existingSession = await tx.attendanceSession.findFirst({
        where: { 
          memberId: member.id,
          sessionDay: getTodaySessionDayJS(),
          checkOut: null // Only open sessions
        },
        orderBy: { checkIn: 'desc' }
      })
      
      // If there's an open session, check if it's been long enough for check-out
      if (existingSession) {
        const sessionDuration = calcDuration(fromDate(existingSession.checkIn), now)
        if (sessionDuration >= MIN_SESSION_MINUTES) {
          // Duration met - update lastCheckinAt to now for proper rate limiting
          await tx.member.update({
            where: { id: member.id },
            data: { lastCheckinAt: now.toJSDate() }
          })
          // Continue to session logic (don't return here)
          console.log(`[Attendance Domain] Rate limit bypassed - valid check-out attempt for member: ${member.id}`)
        } else {
          // Session exists but duration not met - still checked in
          return {
            state: "CHECKED_IN" as const,
            memberName: member.name,
            message: `You're already checked in, ${member.name}! 👋`,
            checkInAt: existingSession.checkIn.toISOString(),
            sessionId: existingSession.id
          }
        }
      } else {
        // No open session - this shouldn't happen but handle gracefully
        return {
          state: "CHECKED_IN" as const,
          memberName: member.name,
          message: `You're already checked in, ${member.name}! 👋`,
        }
      }
    }


    // Step 3: Today's sessionDay (IST calendar day — same as dashboard "today")
    const todaySessionDay = getTodaySessionDayJS()

    // Step 4: Get today's session using sessionDay (SOURCE OF TRUTH)
    let todaySession = await tx.attendanceSession.findFirst({
      where: { 
        memberId: member.id,
        sessionDay: todaySessionDay
      },
      orderBy: { checkIn: 'desc' } // Use checkIn field
    })

    // Step 5: Deterministic state machine
    if (!todaySession) {
      // No session today - create new one
      try {
        const newSession = await tx.attendanceSession.create({
          data: { 
            memberId: member.id, 
            sessionDay: todaySessionDay, 
            checkIn: now.toJSDate(), 
            status: 'OPEN',
            source: 'KIOSK'
          }
        })
        
        // Update member's last check-in time
        await tx.member.update({
          where: { id: member.id },
          data: { lastCheckinAt: now.toJSDate() }
        })
        
        return {
          state: "CHECKED_IN" as const,
          memberName: member.name,
          message: `Welcome, ${member.name}! ✅`,
          checkInAt: newSession.checkIn.toISOString(),
          sessionId: newSession.id
        }
      } catch (error: any) {
        // Unique constraint hit - session already exists
        if (error?.code === 'P2002') {
          todaySession = await tx.attendanceSession.findFirst({
            where: { 
              memberId: member.id,
              sessionDay: todaySessionDay
            }
          })
        } else {
          throw error
        }
      }
    }


    // If still no session after handling constraint, something is wrong
    if (!todaySession) {
      throw new Error('Failed to create or find session')
    }

    // Step 6: Handle existing session
    if (todaySession.checkOut) {
      // Already completed today - calculate duration on the fly
      const duration = calcDuration(fromDate(todaySession.checkIn), fromDate(todaySession.checkOut))
      return {
        state: "ALREADY_DONE",
        memberName: member.name,
        message: `Already completed today's session, ${member.name}!`,
        checkInAt: todaySession.checkIn.toISOString(), 
        checkOutAt: todaySession.checkOut.toISOString(), 
        durationMinutes: Math.round(duration),
        durationFormatted: formatDuration(duration),
        sessionId: todaySession.id
      }
    }

    // Step 7: Open session - check duration
    const gap = calcDuration(fromDate(todaySession.checkIn), now) 
    
    if (gap < MIN_SESSION_MINUTES) {
      // Too soon - still checked in
      return {
        state: "CHECKED_IN",
        memberName: member.name,
        message: `You're already checked in, ${member.name}! 👋`,
        checkInAt: todaySession.checkIn.toISOString(), 
        sessionId: todaySession.id
      }
    }

    // Step 8: Valid duration - check out normally
    await tx.attendanceSession.update({
      where: { id: todaySession.id },
      data: { 
        checkOut: now.toJSDate(), 
        status: 'CLOSED'
      }
    })
    
    // Step 9: Cleanup OLD sessions AFTER current session is handled
    await cleanupOldSessionsInTransaction(member.id, now, tx)
    
    return {
      state: "CHECKED_OUT",
      memberName: member.name,
      message: `Goodbye, ${member.name}! You stayed for ${formatDuration(gap)} 💪`,
      checkInAt: todaySession.checkIn.toISOString(), 
      checkOutAt: now.toISO() || now.toString(),
      durationMinutes: Math.round(gap),
      durationFormatted: formatDuration(gap),
      sessionId: todaySession.id
    }

  })
}

/**
 * Cleanup OLD sessions in transaction (only previous days, not today)
 * Uses gym closing time for realistic checkOut instead of 0-minute durations.
 */
export async function cleanupOldSessionsInTransaction(
  memberId: string,
  now: DateTime,
  tx: PrismaTransaction
): Promise<number> {
  const todaySessionDay = getTodaySessionDayJS()

  const oldOpenSessions = await tx.attendanceSession.findMany({
    where: {
      memberId,
      checkOut: null,
      sessionDay: {
        lt: todaySessionDay
      }
    },
    take: CLEANUP_LIMIT_PER_MEMBER,
    orderBy: { checkIn: 'asc' }
  })

  for (const session of oldOpenSessions) {
    // Set checkOut to gym closing time (default 10 PM) on that session's day
    const sessionDayIST = DateTime.fromJSDate(session.sessionDay, { zone: 'Asia/Kolkata' })
    const closingTime = sessionDayIST.set({ hour: DEFAULT_CLOSING_HOUR, minute: 0, second: 0 })
    const checkInTime = DateTime.fromJSDate(session.checkIn)
    // Never set checkOut before checkIn
    const checkOutTime = closingTime > checkInTime ? closingTime : checkInTime.plus({ minutes: 1 })

    await tx.attendanceSession.update({
      where: { id: session.id },
      data: {
        checkOut: checkOutTime.toJSDate(),
        status: 'AUTO_CLOSED',
        autoClosed: true,
        closeReason: 'PREVIOUS_DAY'
      }
    })
  }

  return oldOpenSessions.length
}


/**
 * Validate session with complete invariants
 * FIX: Same-day check, complete validation rules
 */
export function validateSession(
  sessionDay: Date,
  checkIn: Date,
  checkOut: Date | null,
  nowJS: Date // Require explicit now to avoid implicit local new Date()
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

  const checkInDT = fromDate(checkIn)
  const nowDT = fromDate(nowJS)
  const checkOutDT = checkOut ? fromDate(checkOut) : null

  // Rule 1: Check-in time validation
  if (checkInDT > nowDT) {
    errors.push("Check-in time cannot be in future")
  }

  // Rule 2: Check-out time validation
  if (checkOutDT) {
    if (checkOutDT < checkInDT) {
      errors.push("Check-out time cannot be before check-in time")
    }
    if (checkOutDT > nowDT) {
      errors.push("Check-out time cannot be in future")
    }

    // Check-out must be same day as check-in (IST)
    const checkInIST = checkInDT.setZone('Asia/Kolkata')
    const checkOutIST = checkOutDT.setZone('Asia/Kolkata')

    if (!checkOutIST.hasSame(checkInIST, 'day')) {
      errors.push("Check-out must be on same day as check-in (IST)")
      warnings.push("Session will be auto-closed to previous day boundary")
    }
  }

  // Rule 3: Duration validation
  if (checkOutDT) {
    const duration = calcDuration(checkInDT, checkOutDT)
    
    if (duration < MIN_SESSION_MINUTES) {
      warnings.push(`Session duration ${duration}min is less than minimum ${MIN_SESSION_MINUTES}min`)
    }
    if (duration > MAX_DURATION_MINUTES) {
      warnings.push(`Session duration ${duration}min exceeds maximum ${MAX_DURATION_MINUTES}min`)
    }
  }

  // Determine allowed actions
  if (!checkOutDT) {
    const durationSinceCheckIn = calcDuration(checkInDT, nowDT)
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
  
  const where: Prisma.AttendanceSessionWhereInput = {
    memberId,
    member: { status: { not: "DELETED" } },
  }
  
  // Filter by sessionDay (not date) - SOURCE OF TRUTH
  if (startDate || endDate) {
    where.sessionDay = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    }
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
 * Valid = completed checkout, not auto-closed, member not deleted.
 * Invalid = open (no checkout) or auto-closed, same date/member scope.
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

  const rangeFilter: Prisma.AttendanceSessionWhereInput = {}
  if (startDate || endDate) {
    rangeFilter.sessionDay = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    }
  }

  const memberScope: Prisma.AttendanceSessionWhereInput = {
    ...rangeFilter,
    member: { status: { not: "DELETED" } },
    ...(memberId ? { memberId } : {}),
  }

  const validWhere: Prisma.AttendanceSessionWhereInput = {
    ...memberScope,
    checkOut: { not: null },
    autoClosed: false,
  }

  const invalidWhere: Prisma.AttendanceSessionWhereInput = {
    ...memberScope,
    OR: [{ autoClosed: true }, { checkOut: null }],
  }

  const [validRows, invalidSessions] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: validWhere,
      select: { checkIn: true, checkOut: true },
    }),
    prisma.attendanceSession.count({ where: invalidWhere }),
  ])

  const validSessions = validRows.length
  const totalMinutes = validRows.reduce((sum, session) => {
    if (!session.checkOut) return sum
    return sum + calcDuration(fromDate(session.checkIn), fromDate(session.checkOut))
  }, 0)
  const avgMinutes = validSessions > 0 ? Math.round(totalMinutes / validSessions) : 0

  return {
    totalSessions: validSessions,
    validSessions,
    invalidSessions,
    totalMinutes,
    avgMinutes,
    avgHours: Math.floor(avgMinutes / 60),
    avgRemainingMinutes: avgMinutes % 60,
  }
}

/**
 * Valid sessions only for admin reports: checkout present, not auto-closed, member not deleted.
 */
export async function listValidSessionsForReport(
  memberId: string | undefined,
  startDate: Date | undefined,
  endDate: Date | undefined
) {
  const rangeFilter: Prisma.AttendanceSessionWhereInput = {}
  if (startDate || endDate) {
    rangeFilter.sessionDay = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDate ? { lte: endDate } : {}),
    }
  }

  const where: Prisma.AttendanceSessionWhereInput = {
    ...rangeFilter,
    checkOut: { not: null },
    autoClosed: false,
    member: { status: { not: "DELETED" } },
    ...(memberId ? { memberId } : {}),
  }

  return prisma.attendanceSession.findMany({
    where,
    include: {
      member: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { checkIn: "desc" },
  })
}

