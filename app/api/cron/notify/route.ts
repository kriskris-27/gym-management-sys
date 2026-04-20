import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { computeGlobalMemberLedger } from "@/domain/payment"
import { gymNow, gymYmdFromInstant } from "@/lib/gym-datetime"
import { sendMemberWhatsAppNotification } from "@/lib/whatsapp-cloud"
import type { NotificationStatus, NotificationType } from "@prisma/client"
import type { Prisma } from "@prisma/client"

/** Pro / higher plans allow longer runs; Hobby caps lower. */
export const maxDuration = 60
const NOTIFY_JOB_LOCK_KEY = 90421051

/** Vercel Cron invokes GET; manual runs may use POST. Both require CRON_SECRET. */
function verifyCronAuth(request: Request): NextResponse | null {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    console.error("❌ CRON_SECRET is missing from environment!")
    return NextResponse.json({ error: "Server Configuration Error" }, { status: 500 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}

/**
 * Daily job: (1) WhatsApp expiry reminders — subscriptions ending in 5 days and in 1 day;
 * (2) inactivity nudge — active members with no check-in in 4 days (or never visited & account >4d old).
 * Expiry: always reminds to renew; if ledger shows due > 0, also asks to clear pending dues. Dedupes via NotificationLog.
 */
async function runNotifyJob(): Promise<NextResponse> {
  let hasLock = false
  try {
    const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(${NOTIFY_JOB_LOCK_KEY}) AS locked
    `
    hasLock = !!lockRows[0]?.locked
    if (!hasLock) {
      return NextResponse.json(
        { error: "Notification job is already running", code: "JOB_ALREADY_RUNNING" },
        { status: 409 }
      )
    }
  } catch (error) {
    console.error("❌ Failed to acquire notification job lock:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }

  const now = gymNow().toUTC().toJSDate()
  const runId = `run-${Date.now()}`
  const startOfToday = gymNow().startOf("day").toUTC().toJSDate()

  // Track outcomes for the final report
  const stats = {
    expiry5Day: { sent: 0, skipped: 0, failed: 0 },
    expiry1Day: { sent: 0, skipped: 0, failed: 0 },
    inactivity: { sent: 0, skipped: 0, failed: 0 },
    withPendingDue: { tagged: 0 },
  }

  async function writeLog(params: {
    memberId: string
    memberName: string
    recipientPhone: string
    type: NotificationType
    status: NotificationStatus
    templateKey: string
    attemptNumber?: number
    providerMessageId?: string
    errorCode?: string
    errorMessage?: string
    meta?: Prisma.InputJsonValue
  }) {
    await prisma.notificationLog.create({
      data: {
        memberId: params.memberId,
        runId,
        type: params.type,
        status: params.status,
        channel: "WHATSAPP",
        recipientPhone: params.recipientPhone,
        memberNameSnapshot: params.memberName,
        templateKey: params.templateKey,
        attemptNumber: params.attemptNumber ?? 1,
        providerMessageId: params.providerMessageId,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        meta: params.meta,
      },
    })
  }

  try {
    // PREPARE TIME WINDOWS (IST BOUNDED)
    // Expiry targets are checked against IST day starts
    const baseDay = gymNow().startOf("day")
    const fiveDayTargetStart = baseDay.plus({ days: 5 }).toUTC().toJSDate()
    const fiveDayTargetEnd = baseDay.plus({ days: 6 }).toUTC().toJSDate()

    const oneDayTargetStart = baseDay.plus({ days: 1 }).toUTC().toJSDate()
    const oneDayTargetEnd = baseDay.plus({ days: 2 }).toUTC().toJSDate()

    // JOB A: EXPIRY NOTIFICATIONS (5-DAY & 1-DAY)
    // Process 5-Day window
    const candidates5D = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: fiveDayTargetStart, lt: fiveDayTargetEnd },
        member: { status: "ACTIVE" },
      },
      select: {
        endDate: true,
        member: { select: { id: true, phone: true, name: true } },
      },
    })

    for (const c of candidates5D) {
      try {
        const m = c.member
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { memberId: m.id, type: "EXPIRY_5_DAY", status: "SENT", sentAt: { gte: startOfToday } }
        })
        if (alreadySent) {
          stats.expiry5Day.skipped++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: m.phone,
            type: "EXPIRY_5_DAY",
            status: "SKIPPED",
            templateKey: "EXPIRY_5_DAY",
            errorCode: "ALREADY_SENT_TODAY",
            errorMessage: "Notification already sent for this member today",
            meta: { skipReason: "already_sent_today" },
          })
          continue
        }

        if (!m.phone) {
          stats.expiry5Day.failed++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: "",
            type: "EXPIRY_5_DAY",
            status: "FAILED",
            templateKey: "EXPIRY_5_DAY",
            errorCode: "MISSING_PHONE",
            errorMessage: "Member phone is missing",
            meta: { skipReason: "missing_phone" },
          })
          continue
        }

        const ledger = await computeGlobalMemberLedger(m.id)
        const dueAmount = Math.max(0, Math.round(ledger.remaining))
        if (dueAmount > 0) stats.withPendingDue.tagged++

        const expiryDate = gymYmdFromInstant(c.endDate)
        const result = await sendMemberWhatsAppNotification(m.phone, "EXPIRY_5_DAY", m.name, {
          expiryDate,
          dueAmount,
        })
        await writeLog({
          memberId: m.id,
          memberName: m.name,
          recipientPhone: m.phone,
          type: "EXPIRY_5_DAY",
          status: result.ok ? "SENT" : "FAILED",
          templateKey: "EXPIRY_5_DAY",
          providerMessageId: result.providerMessageId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          meta: { expiryDate, dueAmount, whatsappMode: result.mode },
        })
        if (result.ok) stats.expiry5Day.sent++
        else stats.expiry5Day.failed++
      } catch (error) {
        stats.expiry5Day.failed++
        console.error("Expiry 5-day notify failed:", error)
      }
    }

    // Process 1-Day window
    const candidates1D = await prisma.subscription.findMany({
      where: {
        status: "ACTIVE",
        endDate: { gte: oneDayTargetStart, lt: oneDayTargetEnd },
        member: { status: "ACTIVE" },
      },
      select: {
        endDate: true,
        member: { select: { id: true, phone: true, name: true } },
      },
    })

    for (const c of candidates1D) {
      try {
        const m = c.member
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { memberId: m.id, type: "EXPIRY_1_DAY", status: "SENT", sentAt: { gte: startOfToday } }
        })
        if (alreadySent) {
          stats.expiry1Day.skipped++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: m.phone,
            type: "EXPIRY_1_DAY",
            status: "SKIPPED",
            templateKey: "EXPIRY_1_DAY",
            errorCode: "ALREADY_SENT_TODAY",
            errorMessage: "Notification already sent for this member today",
            meta: { skipReason: "already_sent_today" },
          })
          continue
        }

        if (!m.phone) {
          stats.expiry1Day.failed++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: "",
            type: "EXPIRY_1_DAY",
            status: "FAILED",
            templateKey: "EXPIRY_1_DAY",
            errorCode: "MISSING_PHONE",
            errorMessage: "Member phone is missing",
            meta: { skipReason: "missing_phone" },
          })
          continue
        }

        const ledger = await computeGlobalMemberLedger(m.id)
        const dueAmount = Math.max(0, Math.round(ledger.remaining))
        if (dueAmount > 0) stats.withPendingDue.tagged++

        const expiryDate = gymYmdFromInstant(c.endDate)
        const result = await sendMemberWhatsAppNotification(m.phone, "EXPIRY_1_DAY", m.name, {
          expiryDate,
          dueAmount,
        })
        await writeLog({
          memberId: m.id,
          memberName: m.name,
          recipientPhone: m.phone,
          type: "EXPIRY_1_DAY",
          status: result.ok ? "SENT" : "FAILED",
          templateKey: "EXPIRY_1_DAY",
          providerMessageId: result.providerMessageId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          meta: { expiryDate, dueAmount, whatsappMode: result.mode },
        })
        if (result.ok) stats.expiry1Day.sent++
        else stats.expiry1Day.failed++
      } catch (error) {
        stats.expiry1Day.failed++
        console.error("Expiry 1-day notify failed:", error)
      }
    }


    // JOB B: INACTIVITY NOTIFICATIONS (4-DAY PERSISTENCE)
    const inactivityThreshold = new Date(startOfToday.getTime() - 4 * 24 * 60 * 60 * 1000)

    const inactiveMembers = await prisma.member.findMany({
      where: { 
        status: 'ACTIVE',
        subscriptions: {
          some: {
            status: "ACTIVE",
            startDate: { lte: now },
            endDate: { gte: now },
          },
        },
        OR: [
          {
            // Case 1: Has attendance, but none in the last 4 days
            sessions: {
              some: {},
              none: { checkIn: { gte: inactivityThreshold } }
            }
          },
          {
            // Case 2: No attendance records, and account created > 4 days ago
            sessions: { none: {} },
            createdAt: { lt: inactivityThreshold }
          }
        ]
      },
      select: { 
        id: true, 
        phone: true, 
        name: true, 
        createdAt: true,
        sessions: {
          orderBy: { checkIn: 'desc' },
          take: 1
        }
      }
    })

    console.log("[INACTIVITY] Raw inactiveMembers:", inactiveMembers)
    for (const m of inactiveMembers) {
      try {
        const lastVisit = m.sessions[0]?.checkIn || m.createdAt

        // Only nudge if they haven't been nudged since their last visit/creation
        const alreadyNudgedInThisStreak = await prisma.notificationLog.findFirst({
           where: { 
             memberId: m.id, 
             type: "INACTIVITY",
             status: "SENT",
             sentAt: { gt: lastVisit } 
           }
        })
        
        if (alreadyNudgedInThisStreak) { 
          stats.inactivity.skipped++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: m.phone,
            type: "INACTIVITY",
            status: "SKIPPED",
            templateKey: "INACTIVITY",
            errorCode: "ALREADY_SENT_IN_STREAK",
            errorMessage: "Member already nudged in this inactivity streak",
            meta: { skipReason: "already_sent_in_streak", lastVisit: lastVisit.toISOString() },
          })
          continue 
        }

        if (!m.phone) {
          stats.inactivity.failed++
          await writeLog({
            memberId: m.id,
            memberName: m.name,
            recipientPhone: "",
            type: "INACTIVITY",
            status: "FAILED",
            templateKey: "INACTIVITY",
            errorCode: "MISSING_PHONE",
            errorMessage: "Member phone is missing",
            meta: { skipReason: "missing_phone" },
          })
          continue
        }

        const result = await sendMemberWhatsAppNotification(m.phone, "INACTIVITY", m.name)
        await writeLog({
          memberId: m.id,
          memberName: m.name,
          recipientPhone: m.phone,
          type: "INACTIVITY",
          status: result.ok ? "SENT" : "FAILED",
          templateKey: "INACTIVITY",
          providerMessageId: result.providerMessageId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          meta: { lastVisit: lastVisit.toISOString(), whatsappMode: result.mode },
        })
        if (result.ok) stats.inactivity.sent++
        else stats.inactivity.failed++
      } catch (error) {
        stats.inactivity.failed++
        console.error("Inactivity notify failed:", error)
      }
    }

    return NextResponse.json({ 
      success: true, 
      processed: stats,
    })

  } catch (error) {
    console.error("❌ CRON Execution Failure:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  } finally {
    if (hasLock) {
      try {
        await prisma.$queryRaw<Array<{ unlocked: boolean }>>`
          SELECT pg_advisory_unlock(${NOTIFY_JOB_LOCK_KEY}) AS unlocked
        `
      } catch (unlockErr) {
        console.error("❌ Failed to release notification job lock:", unlockErr)
      }
    }
  }
}

export async function POST(request: Request) {
  const denied = verifyCronAuth(request)
  if (denied) return denied
  return runNotifyJob()
}

export async function GET(request: Request) {
  const denied = verifyCronAuth(request)
  if (denied) return denied
  return runNotifyJob()
}

