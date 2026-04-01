import { NextResponse } from "next/server"
import prisma from "@/lib/prisma-optimized"
import { getISTDateRange } from "@/lib/utils"

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

  // Track outcomes for the final report
  const stats = {
    expiry5Day: { sent: 0, skipped: 0, failed: 0 },
    expiry1Day: { sent: 0, skipped: 0, failed: 0 },
    inactivity: { sent: 0, skipped: 0, failed: 0 },
    statusUpdates: { deactivated: 0, reactivated: 0 }
  }

  try {
    // JOB C: AUTO STATUS UPDATE (RUNS FIRST)
    // This must execute before expiry notifications to prevent notifying newly deactivated members

    // STEP 1: Auto set INACTIVE for expired members
    const expiredMembers = await prisma.member.findMany({
      where: {
        status: "ACTIVE",
        endDate: { lt: now }
      },
      select: { id: true, name: true }
    })

    if (expiredMembers.length > 0) {
      await prisma.member.updateMany({
        where: {
          id: { in: expiredMembers.map((m: any) => m.id) }
        },
        data: { status: "INACTIVE" }
      })
      stats.statusUpdates.deactivated = expiredMembers.length
      console.log(`✅ Auto-deactivated ${expiredMembers.length} expired members`)
    }

    // STEP 2: Auto set ACTIVE for renewed members
    // (members marked INACTIVE but endDate is now in future)
    // This handles case where owner manually extended dates
    const renewedMembers = await prisma.member.findMany({
      where: {
        status: "INACTIVE",
        endDate: { gt: now }
      },
      select: { id: true, name: true }
    })

    if (renewedMembers.length > 0) {
      await prisma.member.updateMany({
        where: {
          id: { in: renewedMembers.map((m: any) => m.id) }
        },
        data: { status: "ACTIVE" }
      })
      stats.statusUpdates.reactivated = renewedMembers.length
      console.log(`✅ Auto-reactivated ${renewedMembers.length} renewed members`)
    }

    // PREPARE TIME WINDOWS (IST BOUNDED)
    // Expiry targets are checked against IST day starts
    const fiveDayTargetStart = new Date(startOfTodayIST.getTime() + 5 * 24 * 60 * 60 * 1000)
    const fiveDayTargetEnd = new Date(fiveDayTargetStart.getTime() + 24 * 60 * 60 * 1000)
    
    const oneDayTargetStart = new Date(startOfTodayIST.getTime() + 1 * 24 * 60 * 60 * 1000)
    const oneDayTargetEnd = new Date(oneDayTargetStart.getTime() + 24 * 60 * 60 * 1000)

    // JOB A: EXPIRY NOTIFICATIONS (5-DAY & 1-DAY)
    // Process 5-Day window
    const candidates5D = await prisma.member.findMany({
      where: { endDate: { gte: fiveDayTargetStart, lt: fiveDayTargetEnd }, status: 'ACTIVE' },
      select: { id: true, phone: true, name: true, endDate: true }
    })

    for (const m of candidates5D) {
      try {
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { memberId: m.id, type: 'EXPIRY_5_DAY', sentAt: { gte: startOfTodayIST } }
        })
        if (alreadySent) { stats.expiry5Day.skipped++; continue; }

        const ok = await sendWhatsAppStub(m.phone, 'EXPIRY_5_DAY', m.name, { expiryDate: m.endDate.toISOString().split('T')[0] })
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'EXPIRY_5_DAY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.expiry5Day.sent++; else stats.expiry5Day.failed++;
      } catch (e) { stats.expiry5Day.failed++; }
    }

    // Process 1-Day window
    const candidates1D = await prisma.member.findMany({
      where: { endDate: { gte: oneDayTargetStart, lt: oneDayTargetEnd }, status: 'ACTIVE' },
      select: { id: true, phone: true, name: true, endDate: true }
    })

    for (const m of candidates1D) {
      try {
        const alreadySent = await prisma.notificationLog.findFirst({
          where: { memberId: m.id, type: 'EXPIRY_1_DAY', sentAt: { gte: startOfTodayIST } }
        })
        if (alreadySent) { stats.expiry1Day.skipped++; continue; }

        const ok = await sendWhatsAppStub(m.phone, 'EXPIRY_1_DAY', m.name, { expiryDate: m.endDate.toISOString().split('T')[0] })
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'EXPIRY_1_DAY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.expiry1Day.sent++; else stats.expiry1Day.failed++;
      } catch (e) { stats.expiry1Day.failed++; }
    }


    // JOB B: INACTIVITY NOTIFICATIONS (4-DAY PERSISTENCE)
    const inactivityThreshold = new Date(startOfTodayIST.getTime() - 4 * 24 * 60 * 60 * 1000)

    const inactiveMembers = await prisma.member.findMany({
      where: { 
        status: 'ACTIVE',
        endDate: { gte: now }, // Protect expired members from inactivity nudges
        OR: [
          {
            // Case 1: Has attendance, but none in the last 4 days
            attendance: {
              some: {},
              none: { checkedInAt: { gte: inactivityThreshold } }
            }
          },
          {
            // Case 2: No attendance records, and account created > 4 days ago
            attendance: { none: {} },
            createdAt: { lt: inactivityThreshold }
          }
        ]
      },
      select: { 
        id: true, 
        phone: true, 
        name: true, 
        createdAt: true,
        attendance: {
          orderBy: { checkedInAt: 'desc' },
          take: 1
        }
      }
    })

    for (const m of inactiveMembers) {
      try {
        const lastVisit = m.attendance[0]?.checkedInAt || m.createdAt

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

        const ok = await sendWhatsAppStub(m.phone, 'INACTIVITY', m.name)
        await prisma.notificationLog.create({ 
          data: { memberId: m.id, type: 'INACTIVITY', status: ok ? 'sent' : 'failed' } 
        })
        if (ok) stats.inactivity.sent++; else stats.inactivity.failed++;
      } catch (e) { stats.inactivity.failed++; }
    }

    return NextResponse.json({ 
      success: true, 
      processed: stats,
      statusUpdates: { 
        deactivated: stats.statusUpdates.deactivated,
        reactivated: stats.statusUpdates.reactivated
      }
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
  meta?: { expiryDate?: string }
): Promise<boolean> {
  const messages = {
    EXPIRY_5_DAY: `Hi ${memberName}, your gym membership expires in 5 days on ${meta?.expiryDate}. Please renew to continue. Contact us: ROYAL FITNESS`,
    EXPIRY_1_DAY: `Hi ${memberName}, your membership expires TOMORROW on ${meta?.expiryDate}. Renew today! Contact us: ROYAL FITNESS`,
    INACTIVITY: `Hi ${memberName}, we miss you at the gym! It has been 4 days since your last visit. Come back today! ROYAL FITNESS`
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
