import prisma from "@/lib/prisma"
import type { PaymentMethod, Prisma } from "@prisma/client"
import { computeGlobalMemberLedger } from "./payment"
import { findLiveSubscription, syncMemberOperationalStatus } from "./subscription"
import { fromDate, nowUTC } from "@/lib/utils"

type Tx = Prisma.TransactionClient
type MemberAction = "renew" | "switch"

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

type RenewSwitchPayload = {
  action: MemberAction
  membershipType?: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  endDate?: string
  customPrice?: number
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

  const restored = await prisma.member.update({
    where: { id: memberId },
    data: { status: "ACTIVE" },
  })
  const syncedStatus = await syncMemberOperationalStatus(memberId)
  return { ...restored, status: syncedStatus }
}

export async function cancelMemberPlan(memberId: string) {
  const activeSub = await findLiveSubscription(memberId)
  if (!activeSub) {
    throw new MemberLifecycleError(400, "No active subscription to cancel", "NO_ACTIVE_SUBSCRIPTION")
  }

  await prisma.subscription.update({
    where: { id: activeSub.id },
    data: { status: "CANCELLED" },
  })
  await syncMemberOperationalStatus(memberId)

  await prisma.auditLog.create({
    data: {
      entityType: "MEMBER",
      entityId: memberId,
      action: "CANCELLED",
      before: { plan: activeSub.planNameSnapshot, id: activeSub.id },
    },
  })

  return { success: true, message: "Subscription cancelled successfully" }
}

async function validateActionPreconditions(memberId: string, action: MemberAction) {
  const latestForAction = await prisma.subscription.findFirst({
    where: { memberId },
    orderBy: { createdAt: "desc" },
  })
  const hasLivePlan = !!(await findLiveSubscription(memberId))

  if (action === "renew") {
    if (latestForAction?.status === "CANCELLED") {
      throw new MemberLifecycleError(
        400,
        "Member has a cancelled plan. Use Switch Plan instead of Renew.",
        "RENEW_USE_SWITCH"
      )
    }
    if (hasLivePlan) {
      throw new MemberLifecycleError(
        400,
        "Member already has an active subscription. Cancel first if you need to change plans.",
        "ALREADY_HAS_LIVE_PLAN"
      )
    }
  }

  if (action === "switch") {
    const cancelledCheck = await prisma.subscription.findFirst({
      where: { memberId, status: "CANCELLED" },
      orderBy: { createdAt: "desc" },
    })
    if (!cancelledCheck) {
      throw new MemberLifecycleError(400, "No cancelled plan to switch from.", "NO_CANCELLED_PLAN")
    }
    if (hasLivePlan) {
      throw new MemberLifecycleError(
        400,
        "Member still has an active subscription period. Cancel it before switching.",
        "STILL_HAS_LIVE_WINDOW"
      )
    }
  }
}

async function applyRenewOutstandingGuard(tx: Tx, memberId: string) {
  const { remaining } = await computeGlobalMemberLedger(memberId, tx)
  if (remaining > 1) {
    throw new MemberLifecycleError(
      403,
      `Cannot renew: Member has an outstanding balance of ₹${remaining}. Please clear previous dues first.`,
      "OUTSTANDING_BALANCE"
    )
  }
}

export async function renewOrSwitchMemberPlan(memberId: string, payload: RenewSwitchPayload) {
  await validateActionPreconditions(memberId, payload.action)

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!member) throw new MemberLifecycleError(404, "Member not found", "NOT_FOUND")

  const subscription = await prisma.$transaction(async (tx) => {
    const nowIST = nowUTC()
    let resolvedStartDate = nowIST

    if (payload.action === "renew") {
      await applyRenewOutstandingGuard(tx, memberId)

      const cancelledSubs = await tx.subscription.findMany({
        where: { memberId, status: "CANCELLED" },
        include: { payments: true },
      })
      for (const sub of cancelledSubs) {
        const paidSum = sub.payments.reduce(
          (acc, p) => acc + (p.status === "SUCCESS" ? p.finalAmount + p.discountAmount : 0),
          0
        )
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: "EXPIRED", planPriceSnapshot: paidSum },
        })
      }

      const expiredSub = await tx.subscription.findFirst({
        where: { memberId, status: "EXPIRED" },
        orderBy: { endDate: "desc" },
      })
      if (expiredSub?.endDate) {
        const expiryDay = fromDate(expiredSub.endDate).startOf("day")
        const todayDay = nowIST.startOf("day")
        const gapDays = Math.max(0, Math.floor(todayDay.diff(expiryDay, "days").days))
        resolvedStartDate = gapDays <= 28 ? fromDate(expiredSub.endDate) : nowIST
      }
    } else {
      const cancelledSub = await tx.subscription.findFirst({
        where: { memberId, status: "CANCELLED" },
        orderBy: { createdAt: "desc" },
      })
      if (cancelledSub) resolvedStartDate = fromDate(cancelledSub.startDate)
    }

    const isImmediate = resolvedStartDate <= nowIST.plus({ minutes: 5 })
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
    const resolvedEndDate = payload.endDate
      ? fromDate(new Date(payload.endDate))
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
        discountAmount: 0,
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
        action: payload.action === "switch" ? "SWITCHED" : "RENEWED",
        after: { plan: resolvedPlanName, startDate: resolvedStartDate.toISO(), amount: resolvedBasePrice },
      },
    })

    return createdSubscription
  })

  return { success: true, member: subscription }
}
