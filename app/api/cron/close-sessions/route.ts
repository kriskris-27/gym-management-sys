import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { fromDate, calcDuration } from "@/lib/utils"
import { DateTime } from "luxon"

/**
 * Default gym closing time (22:00 IST = 10 PM)
 * Used when no custom setting exists
 */
const DEFAULT_CLOSING_HOUR = 22
const DEFAULT_CLOSING_MINUTE = 0
const MAX_DURATION_MINUTES = 4 * 60

/**
 * GET: Nightly Cron — Close all stale attendance sessions
 * 
 * Logic:
 * 1. Finds ALL open sessions from previous days (no batch limit)
 * 2. Sets checkOut to the gym's closing time on the session's day
 *    (gives members a realistic duration instead of 0 minutes)
 * 3. Finds any session open longer than MAX_DURATION (4 hours) today
 *    and closes it with checkOut = checkIn + MAX_DURATION
 * 
 * Schedule: Runs nightly at 11:59 PM IST via Vercel Cron
 * Security: Protected by CRON_SECRET header
 */
export async function GET(request: Request) {
  // 1. SECURITY: Verify cron secret (Vercel sets this automatically)
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 })
  }

  const now = DateTime.now().setZone("Asia/Kolkata")
  const todayStart = now.startOf("day")

  try {
    // 2. FETCH: Get the gym closing time from Settings
    let closingHour = DEFAULT_CLOSING_HOUR
    let closingMinute = DEFAULT_CLOSING_MINUTE

    const closingTimeSetting = await prisma.setting.findUnique({
      where: { key: "gym_closing_time" }
    })

    if (closingTimeSetting?.value) {
      const val = closingTimeSetting.value as { hour?: number; minute?: number }
      if (typeof val.hour === "number") closingHour = val.hour
      if (typeof val.minute === "number") closingMinute = val.minute
    }

    // 3. CLOSE PREVIOUS-DAY SESSIONS
    // Find ALL open sessions where sessionDay < today (no batch limit)
    const staleSessions = await prisma.attendanceSession.findMany({
      where: {
        checkOut: null,
        sessionDay: { lt: todayStart.toJSDate() }
      },
      orderBy: { checkIn: "asc" }
    })

    let previousDayClosed = 0
    const previousDayUpdates = staleSessions.map(session => {
      // Calculate closing time for that session's specific day
      const sessionDayIST = DateTime.fromJSDate(session.sessionDay, { zone: "Asia/Kolkata" })
      const closingTime = sessionDayIST.set({ hour: closingHour, minute: closingMinute, second: 0 })

      // Use closing time as checkOut, but never earlier than checkIn
      const checkInTime = DateTime.fromJSDate(session.checkIn)
      const checkOutTime = closingTime > checkInTime ? closingTime : checkInTime.plus({ minutes: 1 })

      return prisma.attendanceSession.update({
        where: { id: session.id },
        data: {
          checkOut: checkOutTime.toJSDate(),
          status: "AUTO_CLOSED",
          autoClosed: true,
          closeReason: "PREVIOUS_DAY"
        }
      })
    })

    // Execute concurrently for speed, ensuring we beat the 10s Vercel timeout limits
    await Promise.all(previousDayUpdates)
    previousDayClosed = previousDayUpdates.length

    // 4. CLOSE TODAY'S OVER-DURATION SESSIONS
    // Any session open longer than 4 hours today
    const todayOpenSessions = await prisma.attendanceSession.findMany({
      where: {
        checkOut: null,
        sessionDay: { gte: todayStart.toJSDate() }
      }
    })

    let maxDurationClosed = 0
    const maxDurationUpdates = []
    
    for (const session of todayOpenSessions) {
      const checkInDT = fromDate(session.checkIn)
      const duration = calcDuration(checkInDT, now)

      if (duration > MAX_DURATION_MINUTES) {
        // Close at checkIn + MAX_DURATION (realistic end time)
        const closedAt = checkInDT.plus({ minutes: MAX_DURATION_MINUTES })

        maxDurationUpdates.push(
          prisma.attendanceSession.update({
            where: { id: session.id },
            data: {
              checkOut: closedAt.toJSDate(),
              status: "AUTO_CLOSED",
              autoClosed: true,
              closeReason: "MAX_DURATION"
            }
          })
        )
      }
    }

    await Promise.all(maxDurationUpdates)
    maxDurationClosed = maxDurationUpdates.length

    const totalClosed = previousDayClosed + maxDurationClosed

    console.log(
      `[Cron close-sessions] runId=${now.toMillis()} istDate=${todayStart.toISODate()} previousDay=${previousDayClosed} maxDuration=${maxDurationClosed} total=${totalClosed}`
    )

    return NextResponse.json({
      ok: true,
      code: "CRON_CLOSE_SESSIONS_OK",
      closedSessions: totalClosed,
      previousDay: previousDayClosed,
      maxDuration: maxDurationClosed,
      closingTime: `${String(closingHour).padStart(2, "0")}:${String(closingMinute).padStart(2, "0")}`,
      runAt: now.toISO(),
    })

  } catch (error) {
    console.error("❌ Cron close-sessions error:", error)
    return NextResponse.json(
      { error: "Cron close-sessions failed", code: "CRON_CLOSE_SESSIONS_FAILED" },
      { status: 500 }
    )
  }
}
