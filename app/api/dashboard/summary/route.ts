import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { getTodaySessionDayJS, GYM_TIMEZONE } from "@/lib/gym-datetime"
import { getUTCDateRange, nowUTC } from "@/lib/utils"

/**
 * GET: Single request dashboard aggregator
 * Today's attendance uses `sessionDay` (IST calendar day) — same as GET /api/attendance/today.
 */
export async function GET() {
  const auth = await requireAuthUser("GET /api/dashboard/summary")
  if (!auth.ok) return auth.response

  const { todayUTC, tomorrowUTC } = getUTCDateRange()

  const monthStartUTC = todayUTC.startOf("month")
  const monthEndUTC = monthStartUTC.plus({ months: 1 })

  const expiringUntil = tomorrowUTC.plus({ days: 6 })

  const sessionDay = getTodaySessionDayJS()
  const istDateStr = DateTime.fromJSDate(sessionDay, { zone: GYM_TIMEZONE }).toFormat("yyyy-MM-dd")

  try {
    const [todayAttendance, statusCounts, expiringMembers, paymentAggregate, failedNotifs] =
      await Promise.all([
        prisma.attendanceSession.findMany({
          where: {
            sessionDay,
          },
          select: {
            memberId: true,
            checkIn: true,
            checkOut: true,
            sessionDay: true,
            autoClosed: true,
            member: { select: { name: true, status: true } },
          },
          orderBy: { checkIn: "desc" },
        }),

        prisma.member.groupBy({
          by: ["status"],
          where: { status: { not: "DELETED" } },
          _count: { _all: true },
        }),

        prisma.member.findMany({
          where: {
            subscriptions: {
              some: {
                endDate: { gte: todayUTC.toJSDate(), lte: expiringUntil.toJSDate() },
                status: "ACTIVE",
              },
            },
            status: "ACTIVE",
          },
          select: {
            id: true,
            name: true,
            phone: true,
            subscriptions: {
              select: { endDate: true },
              where: { status: "ACTIVE" },
              orderBy: { endDate: "asc" },
              take: 1,
            },
          },
        }),

        prisma.payment.aggregate({
          where: {
            createdAt: { gte: monthStartUTC.toJSDate(), lt: monthEndUTC.toJSDate() },
            status: "SUCCESS",
          },
          _sum: { finalAmount: true },
          _count: true,
        }),

        prisma.notificationLog.count({
          where: { status: "failed" },
        }),
      ])

    const activeAttendance = todayAttendance.filter((a) => a.member.status !== "DELETED")

    const totalPresent = new Set(activeAttendance.map((a) => a.memberId)).size
    const currentlyInside = activeAttendance.filter((a) => !a.checkOut && !a.autoClosed).length

    const statsByStatus = {
      ACTIVE: statusCounts.find((s) => s.status === "ACTIVE")?._count._all || 0,
      INACTIVE: statusCounts.find((s) => s.status === "INACTIVE")?._count._all || 0,
    }

    const membersResponse = {
      total: statsByStatus.ACTIVE + statsByStatus.INACTIVE,
      active: statsByStatus.ACTIVE,
      inactive: statsByStatus.INACTIVE,
      expiringSoon: expiringMembers
        .map((m) => {
          const subscription = m.subscriptions[0]
          if (!subscription) return null

          const now = nowUTC()
          const diff = subscription.endDate.getTime() - now.toJSDate().getTime()
          const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24))
          return {
            id: m.id,
            name: m.name,
            phone: m.phone,
            endDate: subscription.endDate.toISOString().split("T")[0],
            daysLeft: Math.max(0, daysLeft),
          }
        })
        .filter(Boolean),
    }

    return NextResponse.json(
      {
        today: {
          date: istDateStr,
          totalPresent,
          currentlyInside,
          attendance: activeAttendance.map((a) => ({
            memberId: a.memberId,
            memberName: a.member.name,
            checkedInAt: a.checkIn.toISOString(),
            checkedOutAt: a.checkOut?.toISOString() || null,
            autoClosed: a.autoClosed,
          })),
        },
        members: membersResponse,
        payments: {
          thisMonth: paymentAggregate._sum?.finalAmount || 0,
          thisMonthCount: paymentAggregate._count || 0,
        },
        notifications: {
          failedCount: failedNotifs || 0,
        },
      },
      {
        headers: {
          "Cache-Control": "s-maxage=30, stale-while-revalidate",
        },
      }
    )
  } catch (error) {
    console.error("❌ Dashboard Summary Logic Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
