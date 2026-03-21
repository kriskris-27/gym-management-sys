import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getISTDateRange } from "@/lib/utils"

/**
 * GET: Single request dashboard aggregator
 * Logic: Runs 5 specialized queries in parallel for ultra-fast loading.
 */
export async function GET() {
  const now = new Date()
  const { startOfTodayIST, startOfTomorrowIST, istDateStr } = getISTDateRange()

  // 1. CALCULATE IST MONTH WINDOW
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  
  // Format as "YYYY-MM-01T00:00:00+05:30" for precise IST start
  const monthStr = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, "0")}`
  const firstOfMonth = new Date(`${monthStr}-01T00:00:00+05:30`)
  
  // Jump forward and snap to next month's start
  const firstOfNextMonth = new Date(firstOfMonth.getTime() + 32 * 24 * 60 * 60 * 1000)
  firstOfNextMonth.setDate(1)
  firstOfNextMonth.setHours(0, 0, 0, 0)

  // 2. CALCULATE EXPIRING WINDOW (Next 7 days)
  const expiringUntil = new Date(startOfTodayIST.getTime() + 7 * 24 * 60 * 60 * 1000)

  try {
    // RUN EVERYTHING IN PARALLEL
    const [
      todayAttendance,
      statusCounts,
      expiringMembers,
      paymentAggregate,
      failedNotifs
    ] = await Promise.all([
      // A. Active Attendance (For headcount)
      prisma.attendance.findMany({
        where: {
          checkedInAt: { gte: startOfTodayIST, lt: startOfTomorrowIST }
        },
        select: { memberId: true, checkedOutAt: true }
      }),
      
      // B. Membership Distribution
      prisma.member.groupBy({
        by: ['status'],
        where: { status: { not: 'DELETED' } },
        _count: { _all: true }
      }),
      
      // C. Renewal Pipeline (Next 7 days)
      prisma.member.findMany({
        where: {
          endDate: { gte: startOfTodayIST, lte: expiringUntil },
          status: 'ACTIVE'
        },
        select: { id: true, name: true, phone: true, endDate: true },
        orderBy: { endDate: 'asc' }
      }),
      
      // D. Revenue Tracking (Current Month Sum)
      prisma.payment.aggregate({
        where: {
          date: { gte: firstOfMonth, lt: firstOfNextMonth }
        },
        _sum: { amount: true },
        _count: { _all: true }
      }),
      
      // E. System Health (Failed Notifications)
      prisma.notificationLog.count({
        where: { status: 'failed' }
      })
    ])

    // POST-QUERY PROCESSING
    // Unique members who visited today
    const totalPresent = new Set(todayAttendance.map(a => a.memberId)).size
    // Count of members currently checked in
    const currentlyInside = todayAttendance.filter(a => !a.checkedOutAt).length

    // Structure membership stats
    const statsByStatus = {
      ACTIVE: statusCounts.find(s => s.status === 'ACTIVE')?._count._all || 0,
      INACTIVE: statusCounts.find(s => s.status === 'INACTIVE')?._count._all || 0
    }

    const membersResponse = {
      total: statsByStatus.ACTIVE + statsByStatus.INACTIVE,
      active: statsByStatus.ACTIVE,
      inactive: statsByStatus.INACTIVE,
      expiringSoon: expiringMembers.map(m => {
        const diff = m.endDate.getTime() - now.getTime()
        const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24))
        return {
          id: m.id,
          name: m.name,
          phone: m.phone,
          endDate: m.endDate.toISOString().split('T')[0],
          daysLeft: Math.max(0, daysLeft) // Protect against negative results
        }
      })
    }

    return NextResponse.json({
      today: {
        date: istDateStr,
        totalPresent,
        currentlyInside
      },
      members: membersResponse,
      payments: {
        thisMonth: paymentAggregate._sum.amount || 0,
        thisMonthCount: paymentAggregate._count._all || 0
      },
      notifications: {
        failedCount: failedNotifs || 0
      }
    }, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate"
      }
    })

  } catch (error) {
    console.error("❌ Dashboard Summary Logic Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
