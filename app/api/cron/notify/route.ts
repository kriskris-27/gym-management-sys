import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getISTDateRange } from "@/lib/utils"
import { computeGlobalMemberLedger } from "@/domain/payment"
import { DateTime } from "luxon"

/**
 * POST: Daily Automation Job (Expiry Reminders & Inactivity Nudges)
 * Logic: Strictly authenticated by CRON_SECRET. Runs two distinct parallel automation workflows.
 */
export async function POST(request: Request) {
  // 1. SECURITY CHECK (ENFORCED FIRST)
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  
  if (!cronSecret) {
    console.error("❌ CRON_SECRET is missing from environment!")
    return NextResponse.json({ error: "Server Configuration Error" }, { status: 500 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const { startOfTodayIST } = getISTDateRange()
  const startOfToday = DateTime.isDateTime(startOfTodayIST)
    ? startOfTodayIST.toJSDate()
    : new Date(startOfTodayIST)

  // Track outcomes for the final report
  const stats = {
    expiry5Day: { sent: 0, skipped: 0, failed: 0 },
    expiry1Day: { sent: 0, skipped: 0, failed: 0 },
    inactivity: { sent: 0, skipped: 0, failed: 0 },
    withPendingDue: { tagged: 0 },
  }

  try {
    // PREPARE TIME WINDOWS (IST BOUNDED)
    // Expiry targets are checked against IST day starts
    const fiveDayTargetStart = new Date(startOfToday.getTime() + 5 * 24 * 60 * 60 * 1000)
    const fiveDayTargetEnd = new Date(fiveDayTargetStart.getTime() + 24 * 60 * 60 * 1000)
    
    const oneDayTargetStart = new Date(startOfToday.getTime() + 1 * 24 * 60 * 60 * 1000)
    const oneDayTargetEnd = new Date(oneDayTargetStart.getTime() + 24 * 60 * 60 * 1000)

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
          where: { memberId: m.id, type: 'EXPIRY_5_DAY', sentAt: { gte: startOfToday } }
        })
        if (alreadySent) { stats.expiry5Day.skipped++; continue; }

        const ledger = await computeGlobalMemberLedger(m.id)
        const dueAmount = Math.max(0, Math.round(ledger.remaining))
        if (dueAmount > 1) stats.withPendingDue.tagged++

        const ok = await sendWhatsAppStub(m.phone, 'EXPIRY_5_DAY', m.name, { expiryDate: c.endDate.toISOString().split('T')[0], dueAmount })
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'EXPIRY_5_DAY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.expiry5Day.sent++; else stats.expiry5Day.failed++;
      } catch { stats.expiry5Day.failed++; }
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
          where: { memberId: m.id, type: 'EXPIRY_1_DAY', sentAt: { gte: startOfToday } }
        })
        if (alreadySent) { stats.expiry1Day.skipped++; continue; }

        const ledger = await computeGlobalMemberLedger(m.id)
        const dueAmount = Math.max(0, Math.round(ledger.remaining))
        if (dueAmount > 1) stats.withPendingDue.tagged++

        const ok = await sendWhatsAppStub(m.phone, 'EXPIRY_1_DAY', m.name, { expiryDate: c.endDate.toISOString().split('T')[0], dueAmount })
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'EXPIRY_1_DAY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.expiry1Day.sent++; else stats.expiry1Day.failed++;
      } catch { stats.expiry1Day.failed++; }
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

    for (const m of inactiveMembers) {
      try {
        const lastVisit = m.sessions[0]?.checkIn || m.createdAt

        // Only nudge if they haven't been nudged since their last visit/creation
        const alreadyNudgedInThisStreak = await prisma.notificationLog.findFirst({
           where: { 
             memberId: m.id, 
             type: 'INACTIVITY', 
             sentAt: { gt: lastVisit } 
           }
        })
        
        if (alreadyNudgedInThisStreak) { 
          stats.inactivity.skipped++
          continue 
        }

        const ledger = await computeGlobalMemberLedger(m.id)
        const dueAmount = Math.max(0, Math.round(ledger.remaining))
        if (dueAmount > 1) stats.withPendingDue.tagged++

        const ok = await sendWhatsAppStub(m.phone, 'INACTIVITY', m.name, { dueAmount })
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'INACTIVITY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.inactivity.sent++; else stats.inactivity.failed++;
      } catch { stats.inactivity.failed++; }
    }

    return NextResponse.json({ 
      success: true, 
      processed: stats,
    })

  } catch (error) {
    console.error("❌ CRON Execution Failure:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

/**
 * WhatsApp Delivery Engine (Stub Version)
 * Real API integration point for production.
 */
async function sendWhatsAppStub(
  phone: string, 
  type: "EXPIRY_5_DAY" | "EXPIRY_1_DAY" | "INACTIVITY", 
  memberName: string, 
  meta?: { expiryDate?: string; dueAmount?: number }
): Promise<boolean> {
  const dueSuffix = (meta?.dueAmount ?? 0) > 1
    ? ` Pending due: ₹${Math.round(meta?.dueAmount || 0)}. Please clear it.`
    : ""
  const messages = {
    EXPIRY_5_DAY: `Hi ${memberName}, your gym membership expires in 5 days on ${meta?.expiryDate}. Please renew to continue.${dueSuffix} Contact us: ROYAL FITNESS`,
    EXPIRY_1_DAY: `Hi ${memberName}, your membership expires TOMORROW on ${meta?.expiryDate}. Renew today!${dueSuffix} Contact us: ROYAL FITNESS`,
    INACTIVITY: `Hi ${memberName}, we miss you at the gym! It has been 4 days since your last visit. Come back today!${dueSuffix} ROYAL FITNESS`
  }
  
  const msg = messages[type]
  console.log(`[WhatsApp STUB] TO: ${phone} | MSG: ${msg}`)
  
  // Simulation: Always succeed for now
  return true
}

/**
 * Guard: Block GET access to prevent simple URL triggers
 */
export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" }, 
    { status: 405, headers: { "Allow": "POST" } }
  )
}
