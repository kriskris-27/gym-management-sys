import { NextResponse } from "next/server"
import type { MemberStatus, Prisma } from "@prisma/client"
import prisma from "@/lib/prisma"
import { MemberCreateSchema } from "@/lib/validations"
import { syncMemberOperationalStatus } from "@/domain/subscription"
import { membershipEndDateFromStartAndDurationDaysIST } from "@/lib/gym-datetime"

class MemberCreateBizError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "MemberCreateBizError"
    this.status = status
    this.code = code
  }
}

/**
 * GET: List all members with filtering and search
 */
const ALLOWED_MEMBER_LIST_STATUSES = ["ACTIVE", "INACTIVE", "DELETED"] as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")
    ?.trim()
    .slice(0, 100)
  const rawStatus = searchParams.get("status")
  const status = (rawStatus ?? "").trim()
  const limitParam = searchParams.get("limit")
  const pageParam = searchParams.get("page")

  try {
    if (
      rawStatus !== null &&
      status !== "" &&
      !ALLOWED_MEMBER_LIST_STATUSES.includes(
        status as (typeof ALLOWED_MEMBER_LIST_STATUSES)[number]
      )
    ) {
      return NextResponse.json(
        {
          error: "Invalid status. Use ACTIVE, INACTIVE, or DELETED.",
          code: "INVALID_QUERY_STATUS",
        },
        { status: 400 }
      )
    }

    const where: Prisma.MemberWhereInput = {}

    if (
      status &&
      ALLOWED_MEMBER_LIST_STATUSES.includes(
        status as (typeof ALLOWED_MEMBER_LIST_STATUSES)[number]
      )
    ) {
      where.status = status as MemberStatus
    } else {
      where.status = { not: "DELETED" }
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ]
    }

    let skip: number | undefined
    let take: number | undefined
    if (limitParam !== null && limitParam !== "") {
      const limitParsed = parseInt(limitParam, 10)
      const limit =
        Number.isFinite(limitParsed) && limitParsed > 0
          ? Math.min(100, Math.floor(limitParsed))
          : 50
      const pageParsed = parseInt(pageParam ?? "1", 10)
      const page =
        Number.isFinite(pageParsed) && pageParsed > 0
          ? Math.floor(pageParsed)
          : 1
      skip = (page - 1) * limit
      take = limit
    }

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          lastCheckinAt: true,
          updatedAt: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              startDate: true,
              endDate: true,
              status: true,
              planNameSnapshot: true,
              planPriceSnapshot: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        ...(skip !== undefined ? { skip, take } : {}),
      }),
      prisma.member.count({ where }),
    ])

    const { attachFinancialsToMembers } = await import("@/lib/financial-service")
    const membersWithFinance = await attachFinancialsToMembers(members as any)

    const payload: {
      members: typeof membersWithFinance
      total: number
      page?: number
      limit?: number
    } = { members: membersWithFinance, total }
    if (take !== undefined && skip !== undefined) {
      payload.page = Math.floor(skip / take) + 1
      payload.limit = take
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("❌ API ERROR [GET /api/members]:", error)
    return NextResponse.json(
      {
        error: "Could not retrieve members",
        code: "MEMBERS_LIST_FAILED",
      },
      { status: 500 }
    )
  }
}

/**
 * POST: Create a new member (simplified for new schema)
 */
export async function POST(request: Request) {
  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      )
    }

    const validated = MemberCreateSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        {
          error: validated.error.issues[0].message,
          code: "VALIDATION",
        },
        { status: 400 }
      )
    }

    const data = validated.data

    // Use a transaction to ensure Member, Subscription, and Payment are created atomically
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.member.create({
        data: {
          name: data.name,
          phone: data.phone,
          phoneNormalized: data.phone.replace(/\D/g, ""),
          // Synced from subscriptions after writes (never taken from request body).
          status: "INACTIVE",
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          lastCheckinAt: true,
          updatedAt: true,
        },
      })

      let plan = await tx.plan.findFirst({
        where: { name: data.membershipType, isActive: true },
      })

      if (!plan) {
        const byName = await tx.plan.findUnique({
          where: { name: data.membershipType },
        })
        if (byName?.isActive === false) {
          throw new MemberCreateBizError(
            400,
            "PLAN_INACTIVE",
            `Plan "${data.membershipType}" is disabled. Enable it in pricing settings.`
          )
        }
        if (data.membershipType === "OTHERS" && !byName) {
          plan = await tx.plan.create({
            data: {
              name: "OTHERS",
              price: 0,
              durationDays: 1,
              isActive: true,
            },
          })
        } else if (byName?.isActive) {
          plan = byName
        } else {
          throw new MemberCreateBizError(
            400,
            "PLAN_NOT_FOUND",
            `Plan "${data.membershipType}" not found. Configure pricing first.`
          )
        }
      }

      let resolvedPlanName = plan.name
      let resolvedBasePrice = plan.price
      let resolvedEndDate: Date

      if (data.membershipType === "OTHERS") {
        resolvedPlanName = data.manualPlanName || "Others"
        resolvedBasePrice = data.manualAmount ?? 0
        if (!data.endDate) {
          throw new MemberCreateBizError(
            400,
            "VALIDATION",
            "Others membership requires an end date"
          )
        }
        resolvedEndDate = data.endDate
      } else {
        // Server authority: standard plans always use catalog duration in IST (ignore client endDate).
        resolvedEndDate = membershipEndDateFromStartAndDurationDaysIST(
          data.startDate,
          plan.durationDays
        )
      }

      const discount = Math.round(data.discountAmount ?? 0)
      const paid = Math.round(data.paidAmount ?? 0)
      const base = Math.round(resolvedBasePrice)

      if (discount > base) {
        throw new MemberCreateBizError(
          400,
          "DISCOUNT_EXCEEDS_BASE",
          `Discount (₹${discount}) cannot exceed base price (₹${base}).`
        )
      }

      const netDue = Math.max(0, base - discount)
      if (paid > netDue + 1) {
        throw new MemberCreateBizError(
          400,
          "PAID_EXCEEDS_DUE",
          `Amount paid (₹${paid}) cannot exceed net due after discount (₹${netDue}). Remove overpayment or reduce the discount.`
        )
      }

      const subscription = await tx.subscription.create({
        data: {
          memberId: newMember.id,
          planId: plan.id,
          startDate: data.startDate,
          endDate: resolvedEndDate,
          status: "ACTIVE",
          planNameSnapshot: resolvedPlanName,
          planPriceSnapshot: base,
        },
      })

      await tx.payment.create({
        data: {
          memberId: newMember.id,
          subscriptionId: subscription.id,
          baseAmount: base,
          discountAmount: discount,
          finalAmount: paid,
          method: data.paymentMode,
          status: "SUCCESS",
          purpose: "SUBSCRIPTION",
        },
      })

      await tx.auditLog.create({
        data: {
          entityType: "MEMBER",
          entityId: newMember.id,
          action: "CREATED_WITH_SUBSCRIPTION",
          after: {
            name: newMember.name,
            plan: resolvedPlanName,
            baseAmount: base,
            discountAmount: discount,
            netDue,
            finalAmountPaid: paid,
          },
        },
      })

      await syncMemberOperationalStatus(newMember.id, tx)

      return newMember
    })

    return NextResponse.json({ member }, { status: 201 })
  } catch (error) {
    console.error("❌ API ERROR [POST /api/members]:", error)

    if (error instanceof MemberCreateBizError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        {
          error: "Member with this phone already exists",
          code: "DUPLICATE_PHONE",
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      {
        error: "Something went wrong while creating the member.",
        code: "INTERNAL",
      },
      { status: 500 }
    )
  }
}
