import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { AttendanceScanSchema } from "@/lib/validations"

/**
 * IST Helpers provided in instructions
 */
function getTodayIST(): Date {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  return new Date(istNow.toISOString().split("T")[0])
}

function calcDuration(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000)
}

function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hrs === 0) return `${mins}min`
  if (mins === 0) return `${hrs}hr`
  return `${hrs}hr ${mins}min`
}

/**
 * Rate Limiting: 10 requests per IP per minute
 */
const rateLimitMap = new Map<string, { count: number; start: number }>()

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "127.0.0.1"
  const now = new Date()
  const nowMs = now.getTime()

  // 1. RATE LIMIT CHECK (BEFORE DB)
  const rateLimit = rateLimitMap.get(ip)
  if (rateLimit) {
    if (nowMs - rateLimit.start < 60000) {
      if (rateLimit.count >= 10) {
        return NextResponse.json(
          { error: "Too many attempts. Try again in a minute." },
          { status: 429 }
        )
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

    if (!validated.success) {
      return NextResponse.json({ 
        error: (validated.error as any).issues[0].message 
      }, { status: 400 })
    }

    const { phone } = validated.data

    // 2. FIND MEMBER
    const member = await prisma.member.findUnique({
      where: { phone },
    })

    // Secure Response Timing for Not Found
    if (!member || member.status === "DELETED") {
      await new Promise((resolve) => setTimeout(resolve, 400)) // Dummy await
      return NextResponse.json({
        status: "NOT_FOUND",
        memberName: null,
        checkedInAt: null,
        checkedOutAt: null,
        durationMinutes: null,
        durationFormatted: null,
        isExpired: false,
        message: "Phone not registered. Contact your gym owner.",
      }, { status: 404 })
    }

    const isExpired = now > new Date(member.endDate)
    const isManualMode = request.headers.get("x-manual-mode") === "true"

    // 3. FIND LATEST RECORD
    // We specifically look for any open session for this member today or in general
    // to handle the state machine logic for check-ins/check-outs.
    const latestRecord = await prisma.attendance.findFirst({
      where: { memberId: member.id },
      orderBy: { checkedInAt: "desc" },
    })

    const baseResult = {
      memberName: member.name,
      isExpired,
      autoReset: isManualMode ? true : undefined,
    }

    const todayIST = getTodayIST()
    // Helper for date comparison
    const isSameDay = (d1: Date, d2: Date) => 
      d1.toISOString().split("T")[0] === d2.toISOString().split("T")[0]

    // STATE MACHINE
    
    // CASE: No records at all OR Latest is closed and from a different day
    if (!latestRecord || (latestRecord.checkedOutAt && !isSameDay(latestRecord.checkedInAt, todayIST))) {
      await prisma.attendance.create({
        data: { memberId: member.id, date: todayIST, checkedInAt: now },
      })
      return NextResponse.json({
        ...baseResult,
        status: "CHECKED_IN",
        checkedInAt: now.toISOString(),
        checkedOutAt: null,
        durationMinutes: null,
        durationFormatted: null,
        message: `Welcome, ${member.name}! ✅`,
      })
    }

    // CASE: Open record from PREVIOUS day (Forgetful member)
    if (!latestRecord.checkedOutAt && !isSameDay(latestRecord.checkedInAt, todayIST)) {
      await prisma.attendance.update({
        where: { id: latestRecord.id },
        data: { checkedOutAt: now, autoClosed: true },
      })
      await prisma.attendance.create({
        data: { memberId: member.id, date: todayIST, checkedInAt: now },
      })
      return NextResponse.json({
        ...baseResult,
        status: "CHECKED_IN",
        checkedInAt: now.toISOString(),
        checkedOutAt: null,
        durationMinutes: null,
        durationFormatted: null,
        message: `Welcome, ${member.name}! ✅`,
      })
    }

    // CASE: Record exists for TODAY
    if (isSameDay(latestRecord.checkedInAt, todayIST)) {
      if (latestRecord.checkedOutAt) {
        // Already finished session today
        return NextResponse.json({
          ...baseResult,
          status: "ALREADY_DONE",
          checkedInAt: latestRecord.checkedInAt.toISOString(),
          checkedOutAt: latestRecord.checkedOutAt.toISOString(),
          durationMinutes: latestRecord.durationMinutes,
          durationFormatted: formatDuration(latestRecord.durationMinutes || 0),
          message: `Already completed today's session, ${member.name}!`,
        })
      }

      // Open record TODAY
      const gap = calcDuration(latestRecord.checkedInAt, now)

      if (gap < 240) { // Gap < 4 hours → NORMAL CHECK-OUT
        const duration = gap
        await prisma.attendance.update({
          where: { id: latestRecord.id },
          data: { checkedOutAt: now, durationMinutes: duration },
        })
        return NextResponse.json({
          ...baseResult,
          status: "CHECKED_OUT",
          checkedInAt: latestRecord.checkedInAt.toISOString(),
          checkedOutAt: now.toISOString(),
          durationMinutes: duration,
          durationFormatted: formatDuration(duration),
          message: `Goodbye, ${member.name}! You stayed for ${formatDuration(duration)} 💪`,
        })
      } else { // Gap >= 4 hours → AUTO-CLOSE + NEW SESSION
        await prisma.attendance.update({
          where: { id: latestRecord.id },
          data: { checkedOutAt: now, autoClosed: true },
        })
        await prisma.attendance.create({
          data: { memberId: member.id, date: todayIST, checkedInAt: now },
        })
        return NextResponse.json({
          ...baseResult,
          status: "CHECKED_IN",
          checkedInAt: now.toISOString(),
          checkedOutAt: null,
          durationMinutes: null,
          durationFormatted: null,
          message: `Welcome, ${member.name}! ✅`,
        })
      }
    }

    return NextResponse.json({ error: "State machine logic error" }, { status: 500 })

  } catch (error) {
    console.error("❌ Scan Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
