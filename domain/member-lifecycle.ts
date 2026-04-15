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
  isMembershipEndPast,
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

/**
 * Resolve whether the **latest** subscription (by `createdAt`) can be reopened:
 * it must be `EXPIRED`, end date not past in IST, and there must be no `ACTIVE` row.
 * Matches the common delete→restore case (soft-delete flips ACTIVE → EXPIRED on the newest sub).
 * Does not reopen an older EXPIRED row when a newer `CANCELLED` or other row exists.
 */
export async function getCanReopenLastPlan(memberId: string): Promise<boolean> {
  await expireStaleActiveSubscriptionsForMember(memberId)

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { status: true },
  })
  if (!member || member.status === "DELETED") return false
  const hasSoftDeleteHistory = await prisma.auditLog.count({
    where: {
      entityType: "MEMBER",
      entityId: memberId,
      action: "SOFT_DELETED",
    },
  })
  if (hasSoftDeleteHistory > 0) return false

  const activeRows = await prisma.subscription.count({
    where: { memberId, status: "ACTIVE" },
  })
  if (activeRows > 0) return false

  const latest = await prisma.subscription.findFirst({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    select: { status: true, endDate: true },
  })
  if (!latest || latest.status !== "EXPIRED") return false
  if (isMembershipEndPast(latest.endDate)) return false
  return true
}

/**
 * Reopens the **latest** subscription only: must be `EXPIRED` with end date still in IST.
 * Runs stale-active cleanup first (same as renew) so phantom ACTIVE rows do not block incorrectly.
 */
export async function reopenLastExpiredPlanIfEligible(memberId: string) {
  await expireStaleActiveSubscriptionsForMember(memberId)

  const member = await prisma.member.findUnique({ where: { id: memberId } })
  if (!member) throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")
  if (member.status === "DELETED") {
    throw new MemberLifecycleError(
      400,
      "Restore the member before reopening a plan.",
      "MEMBER_DELETED"
    )
  }
  const hasSoftDeleteHistory = await prisma.auditLog.count({
    where: {
      entityType: "MEMBER",
      entityId: memberId,
      action: "SOFT_DELETED",
    },
  })
  if (hasSoftDeleteHistory > 0) {
    throw new MemberLifecycleError(
      400,
      "Old plans cannot be reopened after delete/restore. Please use Add Plan/Renew.",
      "REOPEN_BLOCKED_AFTER_SOFT_DELETE"
    )
  }

  const activeRows = await prisma.subscription.count({
    where: { memberId, status: "ACTIVE" },
  })
  if (activeRows > 0) {
    throw new MemberLifecycleError(
      400,
      "Member already has an active subscription on file.",
      "ACTIVE_SUBSCRIPTION_EXISTS"
    )
  }

  const target = await prisma.subscription.findFirst({
    where: { memberId },
    orderBy: { createdAt: "desc" },
  })
  if (!target) {
    throw new MemberLifecycleError(
      400,
      "No subscription on file to reopen.",
      "NO_REOPENABLE_PLAN"
    )
  }
  if (target.status === "CANCELLED") {
    throw new MemberLifecycleError(
      400,
      "Latest plan is cancelled. Use Add Plan/Renew instead of reopen.",
      "LATEST_PLAN_CANCELLED"
    )
  }
  if (target.status !== "EXPIRED") {
    throw new MemberLifecycleError(
      400,
      "Latest subscription is not in an expired state that can be reopened.",
      "LATEST_NOT_REOPENABLE"
    )
  }
  if (isMembershipEndPast(target.endDate)) {
    throw new MemberLifecycleError(
      400,
      "No previous plan can be reopened — the membership period has ended.",
      "NO_REOPENABLE_PLAN"
    )
  }

  const beforeSnapshot = {
    subscriptionId: target.id,
    status: target.status,
    plan: target.planNameSnapshot,
    endDate: target.endDate.toISOString(),
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: target.id },
      data: { status: "ACTIVE" },
    })
    await tx.auditLog.create({
      data: {
        entityType: "MEMBER",
        entityId: memberId,
        action: "PLAN_REOPENED",
        before: beforeSnapshot,
        after: {
          subscriptionId: target.id,
          status: "ACTIVE",
          plan: target.planNameSnapshot,
          endDate: target.endDate.toISOString(),
        },
      },
    })
  })

  await syncMemberOperationalStatus(memberId)
  const updated = await prisma.subscription.findUnique({ where: { id: target.id } })
  return { success: true as const, subscription: updated }
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
        where: { memberId, status: "ACTIVE" },
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
        finalAmount: payload.paidAmount ?? 0,
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
