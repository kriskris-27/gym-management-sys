import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

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

  // Bound year/month to sensible defaults
  if (isNaN(year) || year < 2020 || year > 2030) year = istYear
  if (isNaN(month) || month < 1 || month > 12) month = istMonth

  // Start/End boundaries for IST Month
  const startOfMonth = new Date(
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`
  )
  const startOfNextMonth = new Date(startOfMonth)
  startOfNextMonth.setMonth(startOfNextMonth.getMonth() + 1)

  try {
    // 2. PARALLEL DB FETCHING
    const [
      payments,
      attendance,
      newMembersCount,
      activeMembersCount,
      expiredMembersCount
    ] = await Promise.all([
      // Financials in range
      prisma.payment.findMany({
        where: { date: { gte: startOfMonth, lt: startOfNextMonth } },
        include: { member: { select: { membershipType: true } } }
      }),
      // Traffic in range
      prisma.attendance.findMany({
        where: { checkedInAt: { gte: startOfMonth, lt: startOfNextMonth } }
      }),
      // Membership Growth
      prisma.member.count({
        where: { createdAt: { gte: startOfMonth, lt: startOfNextMonth }, status: { not: 'DELETED' } }
      }),
      // Snap of Active counts
      prisma.member.count({
        where: { status: 'ACTIVE' }
      }),
      // Expiries occurring this month
      prisma.member.count({
        where: { endDate: { gte: startOfMonth, lt: startOfNextMonth }, status: { not: 'DELETED' } }
      })
    ])

    // 3. REVENUE PROCESSING
    const revenue = {
      total: 0,
      byPlan: { MONTHLY: 0, QUARTERLY: 0, HALF_YEARLY: 0, ANNUAL: 0, PERSONAL_TRAINING: 0 },
      byMode: { CASH: 0, UPI: 0, CARD: 0 },
      dailySummary: {} as Record<string, { amount: number; count: number }>
    }

    payments.forEach(p => {
      revenue.total += p.amount
      revenue.byMode[p.mode as keyof typeof revenue.byMode] += p.amount
      
      const plan = p.member.membershipType
      revenue.byPlan[plan as keyof typeof revenue.byPlan] += p.amount
      
      const dateKey = p.date.toISOString().split('T')[0]
      if (!revenue.dailySummary[dateKey]) {
        revenue.dailySummary[dateKey] = { amount: 0, count: 0 }
      }
      revenue.dailySummary[dateKey].amount += p.amount
      revenue.dailySummary[dateKey].count += 1
    })

    // 4. TRAFFIC PROCESSING
    const traffic = {
      totalSessions: attendance.length,
      uniqueHeadcount: new Set(attendance.map(a => a.memberId)).size,
      accumulatedDuration: 0,
      durationCount: 0,
      dailySummary: {} as Record<string, { count: number; totalDuration: number; durationCount: number }>,
      hourHeatmap: {} as Record<number, number>
    }

    attendance.forEach(a => {
      const dateKey = a.checkedInAt.toISOString().split('T')[0]
      if (!traffic.dailySummary[dateKey]) {
        traffic.dailySummary[dateKey] = { count: 0, totalDuration: 0, durationCount: 0 }
      }
      traffic.dailySummary[dateKey].count += 1

      // Capture check-in hour in IST
      const istHour = new Date(a.checkedInAt.getTime() + istOffset).getUTCHours()
      traffic.hourHeatmap[istHour] = (traffic.hourHeatmap[istHour] || 0) + 1

      if (a.durationMinutes !== null) {
        traffic.accumulatedDuration += a.durationMinutes
        traffic.durationCount += 1
        traffic.dailySummary[dateKey].totalDuration += a.durationMinutes
        traffic.dailySummary[dateKey].durationCount += 1
      }
    })

    // Identify busiest hour
    const peakHourEntry = Object.entries(traffic.hourHeatmap).sort(([, a], [, b]) => b - a)[0]
    const peakHour = peakHourEntry ? parseInt(peakHourEntry[0]) : 0

    // Readable Label
    const reportLabel = startOfMonth.toLocaleString('en-US', { 
      month: 'long', 
      year: 'numeric', 
      timeZone: 'Asia/Kolkata' 
    })

    // 5. FINAL ASSEMBLY
    return NextResponse.json({
      period: { year, month, label: reportLabel },
      revenue: {
        total: revenue.total,
        byPlan: revenue.byPlan,
        byMode: revenue.byMode,
        dailyBreakdown: Object.entries(revenue.dailySummary).map(([date, stats]) => ({ date, ...stats }))
      },
      members: {
        newThisMonth: newMembersCount,
        activeTotal: activeMembersCount,
        expiredThisMonth: expiredMembersCount
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
        peakHour
      }
    }, {
      headers: { 
        "Cache-Control": "s-maxage=300, stale-while-revalidate" 
      }
    })

  } catch (error) {
    console.error("❌ Monthly Report Analysis Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
