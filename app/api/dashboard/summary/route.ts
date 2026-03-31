import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getUTCDateRange, toDisplayTimezone, nowUTC } from "@/lib/utils"

/**
 * GET: Single request dashboard aggregator
 * Logic: Runs 5 specialized queries in parallel for ultra-fast loading.
 * Authentication: Handled by proxy middleware
 */
export async function GET() {
  // 1. TIME AUTHORITY - Single UTC source of truth
  const { todayUTC, tomorrowUTC } = getUTCDateRange()
  
  // 2. DISPLAY TIMEZONE - Convert to IST only for UI response
  const istDateStr = toDisplayTimezone(todayUTC).toFormat('yyyy-MM-dd')
  
  // 3. MONTH RANGE - Get current month UTC dates
  const monthStartUTC = todayUTC.startOf('month')
  const monthEndUTC = monthStartUTC.plus({ months: 1 })
  
  // 4. EXPIRING WINDOW - UTC based calculation
  const expiringUntil = tomorrowUTC.plus({ days: 6 })

  try {
    // RUN EVERYTHING IN PARALLEL
    const [
      todayAttendance,
      statusCounts,
      expiringMembers,
      paymentAggregate,
      failedNotifs
    ] = await Promise.all([
      // A. Active Attendance (For headcount & table)
      prisma.attendanceSession.findMany({
        where: {
          checkIn: { gte: todayUTC.toJSDate(), lt: tomorrowUTC.toJSDate() },
          status: { in: ["OPEN", "CLOSED"] } // 4. VALID STATES ONLY
        },
        select: { 
          memberId: true, 
          checkIn: true, 
          checkOut: true,
          sessionDay: true,
          autoClosed: true,
          member: { select: { name: true } }
        },
        orderBy: { checkIn: 'desc' }
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
          subscriptions: {
            some: {
              endDate: { gte: todayUTC.toJSDate(), lte: expiringUntil.toJSDate() },
              status: 'ACTIVE'
            }
          },
          status: 'ACTIVE'
        },
        select: { 
          id: true, 
          name: true, 
          phone: true, 
          subscriptions: {
            select: { endDate: true },
            where: { status: 'ACTIVE' },
            orderBy: { endDate: 'asc' },
            take: 1
          }
        }
      }),
      
      // D. Revenue Tracking (Current Month Sum)
      prisma.payment.aggregate({
        where: {
          createdAt: { gte: monthStartUTC.toJSDate(), lt: monthEndUTC.toJSDate() },
          status: "SUCCESS" // 3. SUCCESS PAYMENTS ONLY
        },
        _sum: { finalAmount: true },
        _count: true
      }),
      
      // E. System Health (Failed Notifications)
      prisma.notificationLog.count({
        where: { status: 'failed' }
      })
    ])

    // POST-QUERY PROCESSING
    // Unique members who visited today
    const totalPresent = new Set(todayAttendance.map((a: any) => a.memberId)).size
    // Count of members currently checked in
    const currentlyInside = todayAttendance.filter((a: any) => !a.checkOut).length

    // Structure membership stats
    const statsByStatus = {
      ACTIVE: statusCounts.find((s: any) => s.status === 'ACTIVE')?._count._all || 0,
      INACTIVE: statusCounts.find((s: any) => s.status === 'INACTIVE')?._count._all || 0
    }

    const membersResponse = {
      total: statsByStatus.ACTIVE + statsByStatus.INACTIVE,
      active: statsByStatus.ACTIVE,
      inactive: statsByStatus.INACTIVE,
      expiringSoon: expiringMembers.map((m: any) => {
        const subscription = m.subscriptions[0]
        if (!subscription) return null
        
        const now = nowUTC()
        const diff = subscription.endDate.getTime() - now.toJSDate().getTime()
        const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24))
        return {
          id: m.id,
          name: m.name,
          phone: m.phone,
          endDate: subscription.endDate.toISOString().split('T')[0],
          daysLeft: Math.max(0, daysLeft) // Protect against negative results
        }
      }).filter(Boolean) // Remove null entries
    }

    return NextResponse.json({
      today: {
        date: istDateStr,
        totalPresent,
        currentlyInside,
        attendance: todayAttendance.map((a: any) => ({
          memberId: a.memberId,
          memberName: a.member.name,
          checkedInAt: a.checkIn.toISOString(),
          checkedOutAt: a.checkOut?.toISOString() || null,
          autoClosed: a.autoClosed
        }))
      },
      members: membersResponse,
      payments: {
        thisMonth: paymentAggregate._sum?.finalAmount || 0,
        thisMonthCount: paymentAggregate._count || 0
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
