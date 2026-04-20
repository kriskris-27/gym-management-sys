import prisma from "@/lib/prisma"
import type { PaymentMethod, Prisma } from "@prisma/client"
import { getMemberOutstandingSubscriptionDues } from "./payment"
import {
  expireStaleActiveSubscriptionsForMember,
  findLiveSubscription,
  syncMemberOperationalStatus,
} from "./subscription"
import type { DateTime } from "luxon"
import { fromDate } from "@/lib/utils"
import {
  GYM_TIMEZONE,
  gymNow,
  luxonStartOfGymDayFromInput,
} from "@/lib/gym-datetime"

type Tx = Prisma.TransactionClient
type MemberAction = "renew"

export class MemberLifecycleError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code: string = "LIFECYCLE_ERROR") {
    super(message)
    this.name = "MemberLifecycleError"
    this.status = status
    this.code = code
  }
}

type RenewPayload = {
  action: MemberAction
  membershipType?: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  /** Optional explicit subscription start (ISO date string). Overrides computed anchor when valid. */
  startDate?: string
  endDate?: string
  customPrice?: number
  discountAmount?: number
  manualPlanName?: string
  paidAmount?: number
  paymentMode?: PaymentMethod
}

export async function restoreMember(memberId: string) {
  const member = await prisma.member.findUnique({ where: { id: memberId } })
  if (!member) throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")
  if (member.status !== "DELETED") {
    throw new MemberLifecycleError(400, "Member is not deleted", "NOT_DELETED")
  }

  const restored = await prisma.$transaction(async (tx) => {
    // Ensure restored members never retain operational old plans.
    await tx.subscription.updateMany({
      where: { memberId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED" },
    })
    return tx.member.update({
      where: { id: memberId },
      data: { status: "INACTIVE" },
    })
  })
  const syncedStatus = await syncMemberOperationalStatus(memberId)
  return { ...restored, status: syncedStatus }
}

/**
 * Soft-delete: cancel all non-cancelled subscriptions for the member, then mark member DELETED.
 */
export async function softDeleteMember(memberId: string) {
  const member = await prisma.member.findUnique({ where: { id: memberId } })
  if (!member) {
    throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")
  }
  if (member.status === "DELETED") {
    throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { memberId, status: { not: "CANCELLED" } },
      data: { status: "CANCELLED" },
    })

    await tx.member.update({
      where: { id: memberId },
      data: { status: "DELETED" },
    })

    await tx.auditLog.create({
      data: {
        entityType: "MEMBER",
        entityId: memberId,
        action: "SOFT_DELETED",
        before: { status: member.status },
      },
    })
  })

  await syncMemberOperationalStatus(memberId)
  return { success: true as const }
}

async function validateActionPreconditions(memberId: string, action: MemberAction) {
  const hasLivePlan = !!(await findLiveSubscription(memberId))

  if (action === "renew") {
    if (hasLivePlan) {
      throw new MemberLifecycleError(
        400,
        "Member already has an active subscription. Renew is allowed after expiry only.",
        "ALREADY_HAS_LIVE_PLAN"
      )
    }
  }
}

async function applyRenewOutstandingGuard(tx: Tx, memberId: string) {
  const outstandingSubscriptions = await getMemberOutstandingSubscriptionDues(memberId, tx)
  if (outstandingSubscriptions.length > 0) {
    const totalPending = outstandingSubscriptions.reduce((acc, row) => acc + row.remaining, 0)
    const oldestDue = outstandingSubscriptions[outstandingSubscriptions.length - 1]
    throw new MemberLifecycleError(
      403,
      `Cannot renew: old dues of ₹${totalPending} are pending. Oldest unpaid plan is '${oldestDue.planNameSnapshot}' (₹${oldestDue.remaining}). Please clear previous dues first.`,
      "OUTSTANDING_BALANCE"
    )
  }
}

export async function renewMemberPlan(memberId: string, payload: RenewPayload) {
  await expireStaleActiveSubscriptionsForMember(memberId)

  await validateActionPreconditions(memberId, payload.action)

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!member) throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")

  const subscription = await prisma.$transaction(async (tx) => {
    await expireStaleActiveSubscriptionsForMember(memberId, tx)

    const nowGym = gymNow()
    const nowInstant = nowGym.toUTC()
    let resolvedStartDate: DateTime = nowInstant

    if (payload.action === "renew") {
      await applyRenewOutstandingGuard(tx, memberId)

      const expiredSub = await tx.subscription.findFirst({
        where: {
          memberId,
          status: "EXPIRED",
          endDate: { lte: nowInstant.toJSDate() },
        },
        orderBy: { endDate: "desc" },
      })
      if (expiredSub?.endDate) {
        const expiryDay = fromDate(expiredSub.endDate).setZone(GYM_TIMEZONE).startOf("day")
        const todayDay = nowGym.startOf("day")
        const gapDays = Math.max(0, Math.floor(todayDay.diff(expiryDay, "days").days))
        resolvedStartDate = gapDays <= 28 ? fromDate(expiredSub.endDate) : nowInstant
      }
    }

    if (payload.startDate) {
      const parsed = luxonStartOfGymDayFromInput(payload.startDate)
      if (!parsed || !parsed.isValid) {
        throw new MemberLifecycleError(400, "Invalid start date", "INVALID_START_DATE")
      }
      resolvedStartDate = parsed
    }

    const isImmediate = resolvedStartDate <= nowInstant.plus({ minutes: 5 })
    if (isImmediate) {
      await tx.subscription.updateMany({
        where: {
          memberId,
          status: "ACTIVE",
          // Never expire future-dated active rows during an immediate renewal.
          startDate: { lte: nowInstant.toJSDate() },
        },
        data: { status: "EXPIRED" },
      })
    }

    const latestSub = member.subscriptions[0]
    const planName = payload.membershipType || latestSub?.planNameSnapshot || "MONTHLY"
    const planLookup =
      payload.membershipType === "OTHERS" || planName === "OTHERS" ? "OTHERS" : planName
    let plan = await tx.plan.findUnique({ where: { name: planLookup } })
    if (!plan && planLookup === "OTHERS") {
      plan = await tx.plan.create({
        data: { name: "OTHERS", price: 0, durationDays: 1, isActive: true },
      })
    }
    if (!plan) {
      throw new MemberLifecycleError(400, `Plan '${planLookup}' not found.`, "PLAN_NOT_FOUND")
    }

    const resolvedPlanName =
      payload.membershipType === "OTHERS" ? payload.manualPlanName || "Others" : plan.name
    const resolvedBasePrice = payload.customPrice !== undefined ? payload.customPrice : plan.price
    const resolvedDiscount = Math.round(payload.discountAmount ?? 0)

    if (resolvedDiscount < 0) {
      throw new MemberLifecycleError(400, "Discount cannot be negative.", "DISCOUNT_NEGATIVE")
    }
    if (resolvedDiscount > Math.round(resolvedBasePrice)) {
      throw new MemberLifecycleError(
        400,
        `Discount (₹${resolvedDiscount}) cannot exceed plan amount (₹${Math.round(resolvedBasePrice)}).`,
        "DISCOUNT_EXCEEDS_BASE"
      )
    }
    const resolvedEndDate = payload.endDate
      ? (() => {
          const endLux = luxonStartOfGymDayFromInput(payload.endDate)
          if (!endLux || !endLux.isValid) {
            throw new MemberLifecycleError(400, "Invalid end date", "INVALID_END_DATE")
          }
          return endLux
        })()
      : resolvedStartDate.plus({ days: plan.durationDays })

    if (resolvedEndDate <= resolvedStartDate) {
      throw new MemberLifecycleError(
        400,
        "Membership end date must be after the start date.",
        "INVALID_DATE_RANGE"
      )
    }

    const resolvedPaid = Math.round(payload.paidAmount ?? 0)
    const netDue = Math.max(0, Math.round(resolvedBasePrice) - resolvedDiscount)
    if (resolvedPaid > netDue + 1) {
      throw new MemberLifecycleError(
        400,
        `Amount paid (₹${resolvedPaid}) cannot exceed net due after discount (₹${netDue}).`,
        "PAID_EXCEEDS_DUE"
      )
    }

    const createdSubscription = await tx.subscription.create({
      data: {
        memberId,
        planId: plan.id,
        startDate: resolvedStartDate.toJSDate(),
        endDate: resolvedEndDate.toJSDate(),
        status: "ACTIVE",
        planNameSnapshot: resolvedPlanName,
        planPriceSnapshot: resolvedBasePrice,
      },
    })

    await tx.payment.create({
      data: {
        memberId,
        subscriptionId: createdSubscription.id,
        baseAmount: resolvedBasePrice,
        discountAmount: resolvedDiscount,
        finalAmount: resolvedPaid,
        method: payload.paymentMode || "CASH",
        status: "SUCCESS",
        purpose: "SUBSCRIPTION",
      },
    })

    await syncMemberOperationalStatus(memberId, tx)

    await tx.auditLog.create({
      data: {
        entityType: "MEMBER",
        entityId: memberId,
        action: "RENEWED",
        after: {
          plan: resolvedPlanName,
          startDate: resolvedStartDate.toISO(),
          amount: resolvedBasePrice,
          discount: resolvedDiscount,
        },
      },
    })

    return createdSubscription
  })

  return { success: true, member: subscription }
}
