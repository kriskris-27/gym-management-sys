import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { MemberUpdateSchema } from "@/lib/validations"
import {
  lazyExpireStaleSubscriptionsAndSyncMember,
  syncMemberOperationalStatus,
} from "@/domain/subscription"
import {
  deriveMemberPlanState,
  type MemberPlanStateSnapshot,
} from "@/domain/member-status"
import { computeMemberFinancials, emptyMemberFinancials } from "@/lib/financial-service"
import {
  MemberLifecycleError,
  getCanReopenLastPlan,
  renewMemberPlan,
  reopenLastExpiredPlanIfEligible,
  restoreMember,
  softDeleteMember,
} from "@/domain/member-lifecycle"
import { gymNow } from "@/lib/gym-datetime"

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

const memberDetailPlanStateFallback: MemberPlanStateSnapshot = {
  planUiState: "NEEDS_PLAN",
  displaySubscription: null,
}

/**
 * GET: Retrieve single member with attendance stats.
 * Runs lazy subscription expiry + operational status sync so stale ACTIVE rows and Member.status stay accurate.
 * Guards: Excludes DELETED members
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthUser("GET /api/members/[id]")
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    try {
      await lazyExpireStaleSubscriptionsAndSyncMember(id)
    } catch (lazyErr) {
      console.error(`❌ Member GET: lazyExpireStaleSubscriptionsAndSyncMember failed for ${id}`, lazyErr)
    }

    const member = await prisma.member.findUnique({
      where: { id },
      include: {
        _count: {
          select: { sessions: true },
        },
        sessions: {
          orderBy: { checkIn: "desc" },
          take: 1,
          select: { checkIn: true },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        }
      },
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json(
        { error: "Member not found", code: "MEMBER_NOT_FOUND" },
        { status: 404 }
      )
    }

    const { _count, sessions, ...memberData } = member

    let financials = emptyMemberFinancials()
    try {
      financials = await computeMemberFinancials(id)
    } catch (finErr) {
      console.error(
        `❌ Member GET: computeMemberFinancials failed for ${id}, returning empty ledger`,
        finErr
      )
    }

    let planState = memberDetailPlanStateFallback
    try {
      planState = await deriveMemberPlanState(id)
    } catch (planErr) {
      console.error(
        `❌ Member GET: deriveMemberPlanState failed for ${id}, using fallback plan UI`,
        planErr
      )
    }

    const displaySub = planState.displaySubscription
    const nowInstant = gymNow().toUTC().toJSDate()
    const futurePlansCount = await prisma.subscription.count({
      where: {
        memberId: id,
        status: "ACTIVE",
        startDate: { gt: nowInstant },
      },
    })

    let canReopenLastPlan = false
    try {
      canReopenLastPlan = await getCanReopenLastPlan(id)
    } catch (e) {
      console.error(`❌ Member GET: getCanReopenLastPlan failed for ${id}`, e)
    }

    return NextResponse.json({
      member: {
        ...memberData,
        ...financials,
        membershipType: displaySub?.planNameSnapshot || "NONE",
        subscriptionStatus: displaySub?.status || "INACTIVE",
        startDate: displaySub?.startDate || null,
        endDate: displaySub?.endDate || null,
        planUiState: planState.planUiState,
        attendanceCount: _count.sessions,
        lastVisited: sessions[0]?.checkIn || null,
        futurePlansCount,
        canReopenLastPlan,
      },
    })
  } catch (error) {
    console.error("❌ Member GET Error:", error)
    return NextResponse.json(
      {
        error: "Could not retrieve member",
        code: "MEMBER_GET_FAILED",
      },
      { status: 500 }
    )
  }
}

/**
 * PUT: Partial update of member details
 * Logic: Recalculates endDate if membershipType changes
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthUser("PUT /api/members/[id]")
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      )
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Expected JSON object body", code: "INVALID_BODY" },
        { status: 400 }
      )
    }

    const validated = MemberUpdateSchema.safeParse({
      ...(body as Record<string, unknown>),
      id,
    })
    if (!validated.success) {
      const issues = validated.error.issues.map((issue) => ({
        path: issue.path.map((p) => String(p)),
        message: issue.message,
        code: issue.code,
      }))
      return NextResponse.json(
        {
          error: issues[0]?.message ?? "Validation failed",
          code: "VALIDATION",
          issues,
        },
        { status: 400 }
      )
    }

    const updateData = validated.data

    const existingMember = await prisma.member.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    })

    if (!existingMember || existingMember.status === "DELETED") {
      return NextResponse.json(
        { error: "Member not found", code: "MEMBER_NOT_FOUND" },
        { status: 404 }
      )
    }

    const wantsPlanUpdate =
      updateData.membershipType != null ||
      updateData.startDate != null ||
      updateData.endDate != null

    if (wantsPlanUpdate && !existingMember.subscriptions[0]) {
      return NextResponse.json(
        {
          error: "No subscription on file; use member signup or renew to add a plan.",
          code: "NO_SUBSCRIPTION_FOR_PLAN_UPDATE",
        },
        { status: 400 }
      )
    }

    const updatedMember = await prisma.$transaction(async (tx) => {
      const m = await tx.member.update({
        where: { id },
        data: {
          name: updateData.name,
          phone: updateData.phone,
          phoneNormalized: updateData.phone
            ? updateData.phone.replace(/\D/g, "")
            : undefined,
          status: updateData.status === "DELETED" ? "DELETED" : undefined,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          lastCheckinAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      if (wantsPlanUpdate) {
        const latestSub = existingMember.subscriptions[0]!

        let planId = latestSub.planId
        let planName = latestSub.planNameSnapshot
        let finalPrice = latestSub.planPriceSnapshot

        if (
          updateData.membershipType &&
          updateData.membershipType !== latestSub.planNameSnapshot
        ) {
          if (updateData.membershipType === "OTHERS") {
            let othersPlan = await tx.plan.findUnique({ where: { name: "OTHERS" } })
            if (!othersPlan) {
              othersPlan = await tx.plan.create({
                data: {
                  name: "OTHERS",
                  price: 0,
                  durationDays: 1,
                  isActive: true,
                },
              })
            }
            planId = othersPlan.id
            planName = updateData.manualPlanName || "Others"
            finalPrice = updateData.manualAmount ?? latestSub.planPriceSnapshot ?? 0
          } else {
            const plan = await tx.plan.findUnique({
              where: { name: updateData.membershipType },
            })
            if (plan) {
              planId = plan.id
              planName = plan.name
              finalPrice = plan.price
            }
          }
        } else if (updateData.membershipType === "OTHERS") {
          if (updateData.manualPlanName) planName = updateData.manualPlanName
          if (updateData.manualAmount !== undefined)
            finalPrice = updateData.manualAmount
        }

        const base = Math.round(finalPrice)
        const discount = Math.round(updateData.discountAmount ?? 0)
        if (discount > base) {
          throw new MemberCreateBizError(
            400,
            "DISCOUNT_EXCEEDS_BASE",
            `Discount (₹${discount}) cannot exceed base price (₹${base}).`
          )
        }

        const paymentsCount = await tx.payment.count({
          where: { subscriptionId: latestSub.id, status: "SUCCESS" },
        })

        const isPriceChanging = finalPrice !== latestSub.planPriceSnapshot

        if (isPriceChanging && paymentsCount > 0) {
          throw new MemberCreateBizError(
            400,
            "PRICE_CHANGE_BLOCKED",
            "Cannot change plan price because payments have already been recorded. Cancel and create a new plan if a price adjustment is needed."
          )
        }

        await tx.subscription.update({
          where: { id: latestSub.id },
          data: {
            planId,
            planNameSnapshot: planName,
            planPriceSnapshot: finalPrice,
            startDate: updateData.startDate,
            endDate: updateData.endDate,
          },
        })
      }

      await syncMemberOperationalStatus(id, tx)
      return m
    })

    return NextResponse.json({
      member: updatedMember,
      code: "MEMBER_UPDATED",
    })
  } catch (error) {
    console.error("❌ Member PUT Error:", error)
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
        error: "Could not update member",
        code: "MEMBER_UPDATE_FAILED",
      },
      { status: 500 }
    )
  }
}
/**
 * DELETE: Soft delete a member (mark as DELETED)
 * Logic: Sets status to DELETED instead of hard delete
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthUser("DELETE /api/members/[id]")
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    await softDeleteMember(id)
    return NextResponse.json({
      success: true,
      code: "MEMBER_DELETED",
    })
  } catch (error) {
    console.error("❌ Member DELETE Error:", error)
    if (error instanceof MemberLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }
    return NextResponse.json(
      {
        error: "Could not delete member",
        code: "MEMBER_DELETE_FAILED",
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH: Handler for renewal and restore actions
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthUser("PATCH /api/members/[id]")
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "INVALID_JSON" },
        { status: 400 }
      )
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Expected JSON object body", code: "INVALID_BODY" },
        { status: 400 }
      )
    }

    const action = (body as { action?: unknown }).action

    // CASE 1: Restore deleted member
    if (action === "restore") {
      const { RestoreMemberSchema } = await import("@/lib/validations")
      const validated = RestoreMemberSchema.safeParse(body)
      if (!validated.success) {
        return NextResponse.json(
          {
            error: validated.error.issues[0]?.message ?? "Invalid request",
            code: "VALIDATION",
          },
          { status: 400 }
        )
      }
      const restored = await restoreMember(id)
      return NextResponse.json({ member: restored })
    }

    if (action === "reopen_last_plan") {
      const { ReopenLastPlanSchema } = await import("@/lib/validations")
      const validated = ReopenLastPlanSchema.safeParse(body)
      if (!validated.success) {
        return NextResponse.json(
          {
            error: validated.error.issues[0]?.message ?? "Invalid request",
            code: "VALIDATION",
          },
          { status: 400 }
        )
      }
      const res = await reopenLastExpiredPlanIfEligible(id)
      return NextResponse.json(res)
    }

    // CASE 2: Renewal
    if (action === "renew") {
      const { RenewMemberSchema } = await import("@/lib/validations")
      const validated = RenewMemberSchema.safeParse(body)
      if (!validated.success) {
        return NextResponse.json(
          {
            error: validated.error.issues[0].message,
            code: "VALIDATION",
          },
          { status: 400 }
        )
      }
      const res = await renewMemberPlan(id, {
        action: "renew",
        membershipType: validated.data.membershipType,
        startDate: validated.data.startDate,
        endDate: validated.data.endDate,
        customPrice: validated.data.customPrice,
        discountAmount: validated.data.discountAmount,
        manualPlanName: validated.data.manualPlanName,
        paidAmount: validated.data.paidAmount,
        paymentMode: validated.data.paymentMode,
      })
      return NextResponse.json(res)
    }

    return NextResponse.json(
      { error: "Invalid action", code: "INVALID_ACTION" },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof MemberLifecycleError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }
    console.error("❌ Member PATCH Error:", error)
    return NextResponse.json(
      {
        error: "Could not complete this action",
        code: "MEMBER_PATCH_FAILED",
      },
      { status: 500 }
    )
  }
}