import { NextResponse } from "next/server"
import type { MemberStatus, Prisma } from "@prisma/client"
import prisma from "@/lib/prisma"
import { getAuthUser } from "@/lib/auth"
import { attachFinancialsToMembers, membersListSelect } from "@/lib/financial-service"
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

const MEMBERS_LIST_DEFAULT_PAGE = 1
const MEMBERS_LIST_DEFAULT_LIMIT = 50
const MEMBERS_LIST_MIN_LIMIT = 1
const MEMBERS_LIST_MAX_LIMIT = 100

/**
 * GET /api/members — contract (always present):
 * `{ members, page, limit, total, totalPages }`
 */
export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof getAuthUser>>
  try {
    user = await getAuthUser()
  } catch (error) {
    console.error("❌ API ERROR [GET /api/members] auth/session verification:", error)
    return NextResponse.json(
      {
        error:
          "Session could not be verified. Check authentication configuration or try again.",
        code: "AUTH_VERIFICATION_FAILED",
      },
      { status: 503 }
    )
  }

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401 }
    )
  }

  try {
    let searchParams: URLSearchParams
    try {
      searchParams = new URL(request.url).searchParams
    } catch {
      return NextResponse.json(
        { error: "Invalid request URL", code: "INVALID_URL" },
        { status: 400 }
      )
    }

    const search = searchParams.get("search")
      ?.trim()
      .slice(0, 100)
    const rawStatus = searchParams.get("status")
    const status = (rawStatus ?? "").trim()
    const limitParam = searchParams.get("limit")
    const pageParam = searchParams.get("page")

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

    let limit = MEMBERS_LIST_DEFAULT_LIMIT
    if (limitParam !== null && limitParam !== "") {
      const parsed = parseInt(limitParam, 10)
      if (
        !Number.isFinite(parsed) ||
        parsed < MEMBERS_LIST_MIN_LIMIT ||
        parsed > MEMBERS_LIST_MAX_LIMIT
      ) {
        return NextResponse.json(
          {
            error: `limit must be an integer between ${MEMBERS_LIST_MIN_LIMIT} and ${MEMBERS_LIST_MAX_LIMIT}.`,
            code: "INVALID_LIMIT",
          },
          { status: 400 }
        )
      }
      limit = Math.floor(parsed)
    }

    let requestedPage = MEMBERS_LIST_DEFAULT_PAGE
    if (pageParam !== null && pageParam !== "") {
      const parsed = parseInt(pageParam, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: "page must be a positive integer.", code: "INVALID_PAGE" },
          { status: 400 }
        )
      }
      requestedPage = Math.floor(parsed)
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

    const total = await prisma.member.count({ where })
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const page = Math.min(requestedPage, totalPages)
    const skip = (page - 1) * limit

    const members = await prisma.member.findMany({
      where,
      select: membersListSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    })

    const membersWithFinance = await attachFinancialsToMembers(members)

    return NextResponse.json(
      {
        members: membersWithFinance,
        page,
        limit,
        total,
        totalPages,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    )
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
