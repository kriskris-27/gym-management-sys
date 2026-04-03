import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

// Type definitions for report data
interface PaymentWithMember {
  amount: number
  mode: string
  date: Date
  member: {
    membershipType: string
    createdAt: Date
  }
}

interface AttendanceRecord {
  id: string
  checkedInAt: Date
  memberId: string
  durationMinutes: number | null
}

/**
 * GET: Monthly Analytics Report
 * Logic: Aggregates revenue, membership trends, and attendance patterns into a single view.
 * All calculations are pinned to IST (UTC+5:30).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  // 1. BASELINE IST CALCULATIONS
  const istOffset = 5.5 * 60 * 60 * 1000
  const now = new Date()
  const istNow = new Date(now.getTime() + istOffset)
  const istYear = istNow.getUTCFullYear()
  const istMonth = istNow.getUTCMonth() + 1 // 1-indexed

  // Parameter Extraction and Safety Validation
  let year = parseInt(searchParams.get("year") || istYear.toString())
  let month = parseInt(searchParams.get("month") || istMonth.toString())

  if (isNaN(year) || year < 2020 || year > 2030) year = istYear
  if (isNaN(month) || month < 1 || month > 12) month = istMonth

  const startOfMonth = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`)
  const startOfNextMonth = new Date(startOfMonth)
  startOfNextMonth.setMonth(startOfNextMonth.getMonth() + 1)

  try {
    // 2. FETCH DATA
    const [payments, sessions, newMembersCount, activeMembersCount, expiredMembersCount] = await Promise.all([
      prisma.payment.findMany({
        where: { createdAt: { gte: startOfMonth, lt: startOfNextMonth }, status: "SUCCESS" },
        include: { 
          member: { select: { createdAt: true } },
          subscription: { select: { planNameSnapshot: true, plan: { select: { name: true } } } }
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
      })
    ])

    // 3. REVENUE PROCESSING
    const revenue = {
      total: 0,
      byPlan: { MONTHLY: 0, QUARTERLY: 0, HALF_YEARLY: 0, ANNUAL: 0, OTHERS: 0 },
      byMode: { CASH: 0, UPI: 0, CARD: 0 },
      dailySummary: {} as Record<string, { amount: number; count: number }>
    }

    const renewalsThisMonth = payments.filter((p: any) => p.member.createdAt < startOfMonth).length

    payments.forEach((p: any) => {
      const finalAmount = p.finalAmount || p.baseAmount || 0
      revenue.total += finalAmount
      revenue.byMode[p.method as keyof typeof revenue.byMode] += finalAmount
      
      const planBaseName = p.subscription?.plan?.name || "OTHERS"
      let category = "OTHERS"
      if (["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"].includes(planBaseName)) {
        category = planBaseName
      }
      revenue.byPlan[category as keyof typeof revenue.byPlan] += finalAmount
      
      const dateKey = p.createdAt.toISOString().split('T')[0]
      if (!revenue.dailySummary[dateKey]) {
        revenue.dailySummary[dateKey] = { amount: 0, count: 0 }
      }
      revenue.dailySummary[dateKey].amount += finalAmount
      revenue.dailySummary[dateKey].count += 1
    })

    // 4. TRAFFIC PROCESSING
    const traffic = {
      totalSessions: sessions.length,
      uniqueHeadcount: new Set(sessions.map((a: any) => a.memberId)).size,
      accumulatedDuration: 0,
      durationCount: 0,
      dailySummary: {} as Record<string, { count: number; totalDuration: number; durationCount: number }>,
      hourHeatmap: {} as Record<number, number>
    }

    sessions.forEach((a: any) => {
      const dateKey = a.checkIn.toISOString().split('T')[0]
      if (!traffic.dailySummary[dateKey]) {
        traffic.dailySummary[dateKey] = { count: 0, totalDuration: 0, durationCount: 0 }
      }
      traffic.dailySummary[dateKey].count += 1

      const istHour = new Date(a.checkIn.getTime() + istOffset).getUTCHours()
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
    const reportLabel = startOfMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

    return NextResponse.json({
      period: { year, month, label: reportLabel },
      revenue: {
        total: revenue.total,
        byPlan: revenue.byPlan,
        byMode: revenue.byMode,
        dailyBreakdown: Object.entries(revenue.dailySummary).map(([date, stats]: [string, { amount: number; count: number }]) => ({ date, ...stats }))
      },
      members: {
        newThisMonth: newMembersCount,
        activeTotal: activeMembersCount,
        expiredThisMonth: expiredMembersCount,
        renewalsThisMonth
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
    }, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate" }
    })

  } catch (error) {
    console.error("❌ Monthly Report Analysis Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

