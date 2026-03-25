import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { AttendanceScanSchema } from "@/lib/validations"
import { getISTDateRange, calcDuration, formatDuration } from "@/lib/utils"
import { cleanupMemberSessions } from "@/lib/attendance-cleanup"

const rateLimitMap = new Map<string, { count: number; start: number }>()

// Clean stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60000
  for (const [ip, data] of rateLimitMap.entries()) {
    if (data.start < cutoff) rateLimitMap.delete(ip)
  }
}, 5 * 60 * 1000)

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "127.0.0.1"
  const now = new Date()
  const nowMs = now.getTime()

  // 1. RATE LIMITING
  const rateLimit = rateLimitMap.get(ip)
  if (rateLimit) {
    if (nowMs - rateLimit.start < 60000) {
      if (rateLimit.count >= 10) {
        return NextResponse.json({ error: "Too many attempts" }, { status: 429 })
      }
      rateLimit.count++
    } else {
      rateLimitMap.set(ip, { count: 1, start: nowMs })
    }
  } else {
    rateLimitMap.set(ip, { count: 1, start: nowMs })
  }

  try {
    const body = await request.json()
    const validated = AttendanceScanSchema.safeParse(body)
    if (!validated.success) return NextResponse.json({ error: "Invalid phone" }, { status: 400 })

    const { phone } = validated.data

    // 2. FIND MEMBER
    const member = await prisma.member.findUnique({ where: { phone } })
    if (!member || member.status === "DELETED") {
      await new Promise(r => setTimeout(r, 400))
      return NextResponse.json({ status: "NOT_FOUND", message: "Phone not registered." }, { status: 404 })
    }

    if (member.status === "INACTIVE") {
      return NextResponse.json({
        status: "INACTIVE",
        memberName: member.name,
        isExpired: true,
        message: "Your membership has expired. Please renew to continue.",
        checkedInAt: null,
        checkedOutAt: null,
        durationMinutes: null,
        durationFormatted: null,
        autoReset: request.headers.get("x-manual-mode") === "true"
      })
    }

    // 3. PRE-CLEANUP: Clean invalid sessions for this member
    await cleanupMemberSessions(member.id, now)

    const { startOfTodayIST, startOfTomorrowIST } = getISTDateRange()
    const isExpired = now > new Date(member.endDate)

    // 4. FIND LATEST RECORD AFTER CLEANUP
    const latestRecord = await prisma.attendance.findFirst({
      where: { memberId: member.id },
      orderBy: { checkedInAt: "desc" },
    })

    const isManualMode = request.headers.get("x-manual-mode") === "true"
    const baseResult = { memberName: member.name, isExpired, autoReset: isManualMode ? true : undefined }

    // Is the latest record within the IST today window?
    const isLatestToday = latestRecord && latestRecord.checkedInAt >= startOfTodayIST && latestRecord.checkedOutAt < startOfTomorrowIST

    // 5. DETERMINISTIC SCAN LOGIC
    if (!latestRecord || (!isLatestToday && latestRecord.checkedOutAt)) {
      // No active session - create new one
      await prisma.attendance.create({
        data: { 
          memberId: member.id, 
          date: startOfTodayIST, 
          checkedInAt: now 
        }
      })
      return NextResponse.json({
        ...baseResult,
        status: "CHECKED_IN",
        message: `Welcome, ${member.name}! ✅`,
        checkedInAt: now.toISOString(),
      })
    }

    // Handle open session from previous day (shouldn't happen after cleanup, but safety check)
    if (!latestRecord.checkedOutAt && !isLatestToday) {
      await prisma.$transaction(async (tx: any) => {
        await tx.attendance.update({
          where: { id: latestRecord.id },
          data: { checkedOutAt: now, autoClosed: true, autoCloseReason: 'PREVIOUS_DAY' }
        })
        await tx.attendance.create({
          data: { 
            memberId: member.id, 
            date: startOfTodayIST, 
            checkedInAt: now 
          }
        })
      })
      return NextResponse.json({
        ...baseResult,
        status: "CHECKED_IN",
        message: `Welcome, ${member.name}! ✅`,
        checkedInAt: now.toISOString(),
      })
    }

    // Handle today's session
    if (isLatestToday) {
      if (latestRecord.checkedOutAt) {
        // Already completed today
        const dur = latestRecord.durationMinutes ?? calcDuration(latestRecord.checkedInAt, latestRecord.checkedOutAt)
        return NextResponse.json({
          ...baseResult,
          status: "ALREADY_DONE",
          message: `Already completed today's session, ${member.name}!`,
          checkedInAt: latestRecord.checkedInAt.toISOString(),
          checkedOutAt: latestRecord.checkedOutAt.toISOString(),
          durationMinutes: dur,
          durationFormatted: formatDuration(dur),
        })
      }

      // Open session today - check duration
      const gap = calcDuration(latestRecord.checkedInAt, now)
      const MIN_SESSION_MINUTES = 5

      if (gap < MIN_SESSION_MINUTES) {
        // Too soon - still checked in
        return NextResponse.json({
          ...baseResult,
          status: "CHECKED_IN",
          message: `You're already checked in, ${member.name}! 👋`,
          checkedInAt: latestRecord.checkedInAt.toISOString(),
          checkedOutAt: null,
          durationMinutes: null,
          durationFormatted: null,
        })
      }

      // Valid session duration - check out normally
      await prisma.attendance.update({
        where: { id: latestRecord.id },
        data: { checkedOutAt: now, durationMinutes: gap },
      })
      return NextResponse.json({
        ...baseResult,
        status: "CHECKED_OUT",
        message: `Goodbye, ${member.name}! You stayed for ${formatDuration(gap)} 💪`,
        checkedInAt: latestRecord.checkedInAt.toISOString(),
        checkedOutAt: now.toISOString(),
        durationMinutes: gap,
        durationFormatted: formatDuration(gap),
      })
    }

    return NextResponse.json({ error: "Logic error" }, { status: 500 })

  } catch (error) {
    console.error("❌ Scan Error:", error)
    return NextResponse.json({ error: "Internal Error" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } }
  )
}
