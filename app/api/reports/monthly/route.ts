import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import type { Prisma } from "@prisma/client"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { GYM_TIMEZONE, gymNow } from "@/lib/gym-datetime"

type MonthlyPaymentRow = Prisma.PaymentGetPayload<{
  include: {
    member: { select: { createdAt: true } }
    subscription: { select: { planNameSnapshot: true; startDate: true } }
  }
}>

type MonthlySessionRow = {
  memberId: string
  checkIn: Date
  checkOut: Date | null
}

/**
 * GET: Monthly Analytics Report
 * Logic: Aggregates revenue, membership trends, and attendance patterns into a single view.
 * All calculations are pinned to IST (UTC+5:30).
 */
export async function GET(request: Request) {
  const auth = await requireAuthUser("GET /api/reports/monthly")
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)

  // 1. Baseline gym-zone (IST) calendar month
  const nowGym = gymNow()
  const istYear = nowGym.year
  const istMonth = nowGym.month

  let year = parseInt(searchParams.get("year") || String(istYear))
  let month = parseInt(searchParams.get("month") || String(istMonth))

  if (isNaN(year) || year < 2020 || year > 2030) year = istYear
  if (isNaN(month) || month < 1 || month > 12) month = istMonth

  const startOfMonthDt = DateTime.fromObject(
    { year, month, day: 1 },
    { zone: GYM_TIMEZONE }
  ).startOf("day")
  const startOfMonth = startOfMonthDt.toJSDate()
  const startOfNextMonth = startOfMonthDt.plus({ months: 1 }).toJSDate()

  try {
    // 2. FETCH DATA
    const [payments, sessions, newMembersCount, activeMembersCount, expiredMembersCount, monthlySubscriptions] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: startOfMonth, lt: startOfNextMonth }, status: "SUCCESS" },
        include: { 
          member: { select: { createdAt: true } },
          subscription: { select: { planNameSnapshot: true, startDate: true } }
        }
      }),
      prisma.attendanceSession.findMany({
        where: { checkIn: { gte: startOfMonth, lt: startOfNextMonth } }
      }),
      prisma.member.count({
        where: { createdAt: { gte: startOfMonth, lt: startOfNextMonth }, status: { not: 'DELETED' } }
      }),
      prisma.member.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({
        where: { endDate: { gte: startOfMonth, lt: startOfNextMonth }, status: 'ACTIVE' }
      }),
      prisma.subscription.findMany({
        where: { startDate: { gte: startOfMonth, lt: startOfNextMonth }, status: { not: "CANCELLED" } }
      })
    ])

    // 3. REVENUE PROCESSING
    const revenueByPlan = { MONTHLY: 0, QUARTERLY: 0, HALF_YEARLY: 0, ANNUAL: 0, OTHERS: 0 }
    const revenueByMode = { CASH: 0, UPI: 0, CARD: 0 }
    const dailyRevenueSummary = {} as Record<string, { amount: number; count: number }>
    let revenueCollected = 0

    // Cash Collections Logic
    payments.forEach((p: MonthlyPaymentRow) => {
      const amt = p.finalAmount || 0
      if (amt <= 0) return
      revenueCollected += amt
      revenueByMode[p.method as keyof typeof revenueByMode] += amt
      const planName = p.subscription?.planNameSnapshot || "OTHERS"
      let category = "OTHERS"
      if (["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"].includes(planName)) {
        category = planName
      }
      revenueByPlan[category as keyof typeof revenueByPlan] += amt
      
      const dateKey = DateTime.fromJSDate(p.createdAt, { zone: "utc" })
        .setZone(GYM_TIMEZONE)
        .toFormat("yyyy-LL-dd")
      if (!dailyRevenueSummary[dateKey]) dailyRevenueSummary[dateKey] = { amount: 0, count: 0 }
      dailyRevenueSummary[dateKey].amount += amt
      dailyRevenueSummary[dateKey].count += 1
    })

    // Sales Revenue (Accrual) Logic
    const expectedRevenueTotal = monthlySubscriptions.reduce((sum, s) => sum + (s.planPriceSnapshot || 0), 0)
    const collectedForCurrentMonthSales = payments.reduce((sum, p: MonthlyPaymentRow) => {
      const soldThisMonth =
        !!p.subscription &&
        p.subscription.startDate >= startOfMonth &&
        p.subscription.startDate < startOfNextMonth
      if (!soldThisMonth) return sum
      return sum + (p.finalAmount || 0)
    }, 0)
    const discountTotal = payments.reduce((sum, p: MonthlyPaymentRow) => {
      const soldThisMonth =
        !!p.subscription &&
        p.subscription.startDate >= startOfMonth &&
        p.subscription.startDate < startOfNextMonth
      if (!soldThisMonth) return sum
      return sum + (p.discountAmount || 0)
    }, 0)
    const carryOverCollected = Math.max(0, revenueCollected - collectedForCurrentMonthSales)
    const gapBeforeDiscount = Math.max(0, expectedRevenueTotal - collectedForCurrentMonthSales)
    const pendingAfterDiscount = Math.max(
      0,
      expectedRevenueTotal - (collectedForCurrentMonthSales + discountTotal)
    )

    // Improved Renewal Logic: Unique members who paid this month and existed before
    const membersWhoPaid = new Set(payments.filter(p => p.finalAmount > 0).map(p => p.memberId))
    const existingMembersCount = await prisma.member.count({
      where: { id: { in: Array.from(membersWhoPaid) }, createdAt: { lt: startOfMonth } }
    })

    // 4. TRAFFIC PROCESSING
    const traffic = {
      totalSessions: sessions.length,
      uniqueHeadcount: new Set(sessions.map((a: MonthlySessionRow) => a.memberId)).size,
      accumulatedDuration: 0,
      durationCount: 0,
      dailySummary: {} as Record<string, { count: number; totalDuration: number; durationCount: number }>,
      hourHeatmap: {} as Record<number, number>
    }

    sessions.forEach((a: MonthlySessionRow) => {
      const checkInZ = DateTime.fromJSDate(a.checkIn, { zone: "utc" }).setZone(GYM_TIMEZONE)
      const dateKey = checkInZ.toFormat("yyyy-LL-dd")
      if (!traffic.dailySummary[dateKey]) traffic.dailySummary[dateKey] = { count: 0, totalDuration: 0, durationCount: 0 }
      traffic.dailySummary[dateKey].count += 1
      const istHour = checkInZ.hour
      traffic.hourHeatmap[istHour] = (traffic.hourHeatmap[istHour] || 0) + 1
      if (a.checkIn && a.checkOut) {
        const duration = Math.round((a.checkOut.getTime() - a.checkIn.getTime()) / (1000 * 60))
        if (duration > 0) {
          traffic.accumulatedDuration += duration
          traffic.durationCount += 1
          traffic.dailySummary[dateKey].totalDuration += duration
          traffic.dailySummary[dateKey].durationCount += 1
        }
      }
    })

    const peakHourEntry = Object.entries(traffic.hourHeatmap).sort(([, a]: [string, number], [, b]: [string, number]) => b - a)[0]
    const peakHour = peakHourEntry ? parseInt(peakHourEntry[0]) : 0
    const reportLabel = startOfMonthDt.toFormat("LLLL yyyy")

    return NextResponse.json({
      period: { year, month, label: reportLabel },
      revenue: {
        total: revenueCollected,
        expectedTotal: expectedRevenueTotal, // Total plan value sold this month
        gap: gapBeforeDiscount, // Gross gap before discount adjustment
        discountTotal,
        collectedForCurrentMonthSales,
        carryOverCollected,
        pendingAfterDiscount, // Actual pending after discount adjustment
        byPlan: revenueByPlan,
        byMode: revenueByMode,
        dailyBreakdown: Object.entries(dailyRevenueSummary).map(([date, stats]) => ({ date, ...stats }))
      },
      members: {
        newThisMonth: newMembersCount,
        activeTotal: activeMembersCount,
        expiredThisMonth: expiredMembersCount,
        renewalsThisMonth: existingMembersCount
      },
      attendance: {
        totalSessions: traffic.totalSessions,
        uniqueMembers: traffic.uniqueHeadcount,
        averageSessionMinutes: traffic.durationCount > 0 ? Math.round(traffic.accumulatedDuration / traffic.durationCount) : 0,
        dailyBreakdown: Object.entries(traffic.dailySummary).map(([date, stats]) => ({
          date,
          count: stats.count,
          averageDuration: stats.durationCount > 0 ? Math.round(stats.totalDuration / stats.durationCount) : 0
        })),
        peakHour,
        hourHeatmap: Array.from({ length: 24 }, (_, h) => traffic.hourHeatmap[h] ?? 0)
      }
    })

  } catch (error) {
    console.error("❌ Monthly Report Analysis Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

