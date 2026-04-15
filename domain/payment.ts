import type { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { subscriptionWindowCoversNow } from "../lib/gym-datetime"
import { findLiveSubscription, getActiveSubscription } from "./subscription"

export { assertGlobalPaymentAllowed, assertNoCurrentPlanOverpay } from "./payment-guards"
import { validatePaymentAmount } from "./payment-validation"
import { computePaymentFromBase } from "./payment-calculation"

export { validatePaymentAmount } from "./payment-validation"
export { computePaymentFromBase } from "./payment-calculation"

/** Prisma client or transaction — same aggregates for global ledger. */
export type PaymentDb = typeof prisma | Prisma.TransactionClient

/**
 * Global ledger: sum(non-cancelled subscription planPriceSnapshot) vs SUCCESS payments + discounts.
 * Used by financial summary UI and renew guard so rules cannot drift.
 */
export async function computeGlobalMemberLedger(
  memberId: string,
  db: PaymentDb = prisma
): Promise<{
  totalAmount: number
  totalPaid: number
  totalDiscount: number
  remaining: number
  isPaidFull: boolean
}> {
  const subSummary = await db.subscription.aggregate({
    where: { memberId, status: { not: "CANCELLED" } },
    _sum: { planPriceSnapshot: true },
  })
  const paySummary = await db.payment.aggregate({
    where: { memberId, status: "SUCCESS" },
    _sum: { finalAmount: true, discountAmount: true },
  })
  const totalAmount = subSummary._sum.planPriceSnapshot || 0
  const totalPaid = paySummary._sum.finalAmount || 0
  const totalDiscount = paySummary._sum.discountAmount || 0
  const remaining = Math.round(totalAmount - (totalPaid + totalDiscount))
  return {
    totalAmount,
    totalPaid,
    totalDiscount,
    remaining,
    isPaidFull: remaining <= 1,
  }
}

/**
 * Balance left on the **live** subscription (IST window covers today).
 * Counts payments linked to that sub **plus** unallocated (`subscriptionId` null) cash,
 * applying orphan payments to the uncovered part of this plan first — matches how global
 * ledger sees money and fixes historical rows saved without `subscriptionId`.
 */
export async function getLivePlanPaymentRemaining(
  memberId: string,
  db: PaymentDb = prisma
): Promise<{
  liveSubscriptionId: string | null
  planAmount: number
  paidLinked: number
  paidOrphanApplied: number
  paid: number
  remaining: number
}> {
  const live = await findLiveSubscription(memberId, db)
  if (!live) {
    return {
      liveSubscriptionId: null,
      planAmount: 0,
      paidLinked: 0,
      paidOrphanApplied: 0,
      paid: 0,
      remaining: 0,
    }
  }
  const [linked, orphan] = await Promise.all([
    db.payment.aggregate({
      where: { memberId, subscriptionId: live.id, status: "SUCCESS" },
      _sum: { finalAmount: true, discountAmount: true },
    }),
    db.payment.aggregate({
      where: { memberId, subscriptionId: null, status: "SUCCESS" },
      _sum: { finalAmount: true, discountAmount: true },
    }),
  ])
  const paidLinked = Math.round(
    (linked._sum.finalAmount || 0) + (linked._sum.discountAmount || 0)
  )
  const orphanTotal = Math.round(
    (orphan._sum.finalAmount || 0) + (orphan._sum.discountAmount || 0)
  )
  const planAmount = Math.round(live.planPriceSnapshot)
  const uncoveredByLinked = Math.max(0, planAmount - paidLinked)
  const paidOrphanApplied = Math.min(orphanTotal, uncoveredByLinked)
  const paid = paidLinked + paidOrphanApplied
  const remaining = Math.max(0, planAmount - paid)
  return {
    liveSubscriptionId: live.id,
    planAmount,
    paidLinked,
    paidOrphanApplied,
    paid,
    remaining,
  }
}

export async function computeSubscriptionLedger(
  subscriptionId: string,
  db: PaymentDb = prisma
): Promise<{
  subscriptionId: string
  memberId: string
  planAmount: number
  paid: number
  discount: number
  remaining: number
  isPaidFull: boolean
}> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, memberId: true, planPriceSnapshot: true, status: true },
  })
  if (!subscription || subscription.status === "CANCELLED") {
    throw new Error(`Subscription not found or cancelled: ${subscriptionId}`)
  }

  const paySummary = await db.payment.aggregate({
    where: { subscriptionId, status: "SUCCESS" },
    _sum: { finalAmount: true, discountAmount: true },
  })

  const planAmount = Math.round(subscription.planPriceSnapshot || 0)
  const paid = Math.round(paySummary._sum.finalAmount || 0)
  const discount = Math.round(paySummary._sum.discountAmount || 0)
  const remaining = Math.max(0, planAmount - (paid + discount))

  return {
    subscriptionId: subscription.id,
    memberId: subscription.memberId,
    planAmount,
    paid,
    discount,
    remaining,
    isPaidFull: remaining <= 1,
  }
}

export async function getMemberOutstandingSubscriptionDues(
  memberId: string,
  db: PaymentDb = prisma
): Promise<
  Array<{
    subscriptionId: string
    status: "ACTIVE" | "EXPIRED" | "CANCELLED"
    createdAt: Date
    planNameSnapshot: string
    planAmount: number
    paid: number
    discount: number
    remaining: number
  }>
> {
  const subscriptions = await db.subscription.findMany({
    where: { memberId, status: { in: ["ACTIVE", "EXPIRED"] } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      planNameSnapshot: true,
      planPriceSnapshot: true,
      payments: {
        where: { status: "SUCCESS" },
        select: { finalAmount: true, discountAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return subscriptions
    .map((sub) => {
      const paid = Math.round(sub.payments.reduce((acc, p) => acc + p.finalAmount, 0))
      const discount = Math.round(sub.payments.reduce((acc, p) => acc + p.discountAmount, 0))
      const planAmount = Math.round(sub.planPriceSnapshot || 0)
      const remaining = Math.max(0, planAmount - (paid + discount))
      return {
        subscriptionId: sub.id,
        status: sub.status,
        createdAt: sub.createdAt,
        planNameSnapshot: sub.planNameSnapshot,
        planAmount,
        paid,
        discount,
        remaining,
      }
    })
    .filter((row) => row.remaining > 1)
}

export interface Payment {
  id: string
  memberId: string
  subscriptionId: string | null
  baseAmount: number
  discountAmount: number
  finalAmount: number
  method: 'CASH' | 'UPI' | 'CARD'
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  purpose: 'SUBSCRIPTION' | 'ADJUSTMENT'
  createdAt: Date
}

export interface PaymentCalculation {
  baseAmount: number
  discountAmount: number
  finalAmount: number
  discountReason?: string
}

/**
 * Get member-specific discount (rule-based + configurable)
 * BUSINESS RULE: Discount = function(memberHistory, context) NOT hardcoded
 * IMPLEMENTATION: Use Setting table for discount rules
 */
export async function getMemberDiscount(memberId: string): Promise<{
  discountPercent: number
  discountReason: string
  isNewMember: boolean
}> {
  console.log(`[Payment Domain] Getting member discount for: ${memberId}`)

  // Get discount rules from settings
  const discountRules = await getDiscountRules()
  
  // Get member's payment history to determine status
  const paymentCount = await prisma.payment.count({
    where: { 
      memberId,
      status: 'SUCCESS'
    }
  })

  // Get member's subscription history
  const subscriptionCount = await prisma.subscription.count({
    where: { memberId }
  })

  // Check if member had active subscription recently (last 90 days)
  const recentSubscription = await prisma.subscription.findFirst({
    where: {
      memberId,
      status: 'ACTIVE',
      endDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
    }
  })

  // Business logic for member classification
  const isNewMember = paymentCount === 0 && subscriptionCount <= 1
  const isReturning = paymentCount > 0 && !recentSubscription

  let discountPercent = 0
  let discountReason = 'No discount'

  if (isNewMember) {
    discountPercent = discountRules.new_member
    discountReason = `New member ${discountPercent}% off`
  } else if (isReturning) {
    discountPercent = discountRules.returning_member
    discountReason = `Returning member ${discountPercent}% off`
  }

  console.log(`[Payment Domain] Member discount: ${discountPercent}% (${discountReason})`)
  
  return {
    discountPercent,
    discountReason,
    isNewMember
  }
}

/**
 * Get discount rules from settings
 */
export async function getDiscountRules(): Promise<{
  new_member: number
  returning_member: number
}> {
  try {
    const newMemberRule = await prisma.setting.findUnique({
      where: { key: 'discount_new_member' }
    })
    const returningMemberRule = await prisma.setting.findUnique({
      where: { key: 'discount_returning_member' }
    })
    
    return {
      new_member: (newMemberRule?.value as number) || 10,
      returning_member: (returningMemberRule?.value as number) || 5
    }
  } catch {
    // Fallback to defaults
    return {
      new_member: 10,
      returning_member: 5
    }
  }
}

/**
 * Calculate payment amounts with controlled discounts
 * BUSINESS RULE: Never allow open-ended discounts
 * FINAL RULE: MAX_DISCOUNT = min(percentage cap, absolute cap)
 */
export async function calculatePayment(
  subscriptionId: string,
  memberDiscountPercent?: number,
  additionalDiscount?: number
): Promise<PaymentCalculation> {
  console.log(`[Payment Domain] Calculating payment for subscription: ${subscriptionId}`)
  
  // Get subscription with plan details
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true }
  })

  if (!subscription) {
    throw new Error(`Subscription not found: ${subscriptionId}`)
  }

  // Base amount from subscription price snapshot
  const baseAmount = subscription.planPriceSnapshot
  console.log(`[Payment Domain] Base amount from subscription: ${baseAmount}`)
  return computePaymentFromBase(baseAmount, memberDiscountPercent, additionalDiscount)
}

/**
 * Create payment record with validation
 * BUSINESS RULE: Controlled validation before creation
 */
export async function createPayment(
  memberId: string,
  subscriptionId: string | null,
  calculation: PaymentCalculation,
  method: 'CASH' | 'UPI' | 'CARD',
  purpose: 'SUBSCRIPTION' | 'ADJUSTMENT' = 'SUBSCRIPTION'
): Promise<Payment> {
  console.log(`[Payment Domain] Creating payment for member: ${memberId}, subscription: ${subscriptionId}`)

  // Validate payment amount before creation
  const validation = validatePaymentAmount(
    calculation.baseAmount,
    calculation.finalAmount,
    purpose
  )
  
  if (!validation.isValid) {
    throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`)
  }

  // Log warnings if any
  if (validation.warnings.length > 0) {
    console.warn(`[Payment Domain] Payment warnings: ${validation.warnings.join(', ')}`)
  }

  const payment = await prisma.payment.create({
    data: {
      memberId,
      subscriptionId,
      baseAmount: calculation.baseAmount,
      discountAmount: calculation.discountAmount,
      finalAmount: calculation.finalAmount,
      method,
      status: 'SUCCESS',
      purpose
    }
  })

  console.log(`[Payment Domain] Created payment: ${payment.id}`)
  return payment
}

/**
 * Get payment history for a member
 * OLD LOGIC: Complex date filtering based on lastRenewalAt
 * NEW LOGIC: Clear subscription association, optional filtering
 */
export async function getMemberPaymentHistory(
  memberId: string,
  subscriptionId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<Payment[]> {
  console.log(`[Payment Domain] Getting payment history for member: ${memberId}`)

  const where: Prisma.PaymentWhereInput = { memberId }
  
  // Filter by subscription if provided
  if (subscriptionId) {
    where.subscriptionId = subscriptionId
  }

  // Filter by date range if provided
  if (startDate || endDate) {
    where.createdAt = {}
    if (startDate) where.createdAt.gte = startDate
    if (endDate) where.createdAt.lte = endDate
  }

  const payments = await prisma.payment.findMany({
    where,
    include: {
      subscription: {
        include: { plan: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  console.log(`[Payment Domain] Found ${payments.length} payments`)
  return payments
}

/**
 * Get payment summary for a subscription
 * OLD LOGIC: Complex aggregation with member-based filtering
 * NEW LOGIC: Clean subscription-based aggregation
 */
export async function getSubscriptionPaymentSummary(
  subscriptionId: string
): Promise<{
  totalPayments: number
  totalBaseAmount: number
  totalDiscountAmount: number
  totalFinalAmount: number
  paymentCount: number
}> {
  console.log(`[Payment Domain] Getting payment summary for subscription: ${subscriptionId}`)

  const summary = await prisma.payment.aggregate({
    where: { 
      subscriptionId,
      status: 'SUCCESS' // Only count successful payments
    },
    _sum: {
      baseAmount: true,
      discountAmount: true,
      finalAmount: true
    },
    _count: true
  })

  return {
    totalPayments: summary._count || 0,
    totalBaseAmount: summary._sum.baseAmount || 0,
    totalDiscountAmount: summary._sum.discountAmount || 0,
    totalFinalAmount: summary._sum.finalAmount || 0,
    paymentCount: summary._count || 0
  }
}

/**
 * Get comprehensive financial summary for a member (GLOBAL BALANCE)
 * Includes total amount across ALL subscriptions vs Total paid across ALL payments
 * SINGLE SOURCE OF TRUTH for a member's debt status.
 */
export async function getMemberSubscriptionFinancialSummary(memberId: string): Promise<{
  totalAmount: number
  totalPaid: number
  remaining: number
  isPaidFull: boolean
  globalTotalAmount: number
  globalTotalPaid: number
  globalRemaining: number
  currentPlanAmount: number
  currentPlanPaid: number
  currentPlanRemaining: number
  subscriptionId?: string
  subscriptionStatus?: string
  latestPlanName?: string
}> {
  console.log(`[Payment Domain] Computing global balance for member: ${memberId}`)

  // 1) Get live subscription (covers now in gym timezone) for "current plan" numbers.
  // This MUST match renewal guards and handle orphan payments consistently.
  const livePlan = await getLivePlanPaymentRemaining(memberId)
  const activeSubscription = await getActiveSubscription(memberId)

  const { totalAmount, totalPaid, remaining, isPaidFull } = await computeGlobalMemberLedger(memberId)

  const latestSubscription = activeSubscription || await prisma.subscription.findFirst({
    where: { memberId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: 'desc' }
  })

  const currentPlanAmount = livePlan.planAmount
  const currentPlanPaid = livePlan.paid
  const currentPlanRemaining = livePlan.remaining

  return {
    totalAmount,
    totalPaid,
    remaining,
    isPaidFull,
    globalTotalAmount: totalAmount,
    globalTotalPaid: totalPaid,
    globalRemaining: remaining,
    currentPlanAmount,
    currentPlanPaid,
    currentPlanRemaining,
    subscriptionId: activeSubscription?.id,
    subscriptionStatus: activeSubscription?.status || "INACTIVE",
    latestPlanName: latestSubscription?.planNameSnapshot || "N/A"
  }
}

/** Same numeric shape as list rows need; aligned with `getMemberSubscriptionFinancialSummary` (no extra metadata). */
export type MemberListFinancialSummary = {
  totalAmount: number
  totalPaid: number
  remaining: number
  isPaidFull: boolean
  globalTotalAmount: number
  globalTotalPaid: number
  globalRemaining: number
  currentPlanAmount: number
  currentPlanPaid: number
  currentPlanRemaining: number
}

function emptyMemberListFinancialSummary(): MemberListFinancialSummary {
  return {
    totalAmount: 0,
    totalPaid: 0,
    remaining: 0,
    isPaidFull: true,
    globalTotalAmount: 0,
    globalTotalPaid: 0,
    globalRemaining: 0,
    currentPlanAmount: 0,
    currentPlanPaid: 0,
    currentPlanRemaining: 0,
  }
}

/**
 * Batch financial summaries for many members (fixed query count, matches single-member summary rules).
 */
export async function batchGetMemberListFinancialSummaries(
  memberIds: string[]
): Promise<Map<string, MemberListFinancialSummary>> {
  const result = new Map<string, MemberListFinancialSummary>()
  if (memberIds.length === 0) return result

  for (const id of memberIds) {
    result.set(id, emptyMemberListFinancialSummary())
  }

  const [subTotals, payTotals, nonCancelledSubs, activeSubs, payBySub] = await Promise.all([
    prisma.subscription.groupBy({
      by: ["memberId"],
      where: { memberId: { in: memberIds }, status: { not: "CANCELLED" } },
      _sum: { planPriceSnapshot: true },
    }),
    prisma.payment.groupBy({
      by: ["memberId"],
      where: { memberId: { in: memberIds }, status: "SUCCESS" },
      _sum: { finalAmount: true, discountAmount: true },
    }),
    prisma.subscription.findMany({
      where: { memberId: { in: memberIds }, status: { not: "CANCELLED" } },
      select: {
        id: true,
        memberId: true,
        startDate: true,
        endDate: true,
        status: true,
        planPriceSnapshot: true,
        createdAt: true,
      },
    }),
    prisma.subscription.findMany({
      where: { memberId: { in: memberIds }, status: "ACTIVE" },
      select: {
        id: true,
        memberId: true,
        startDate: true,
        endDate: true,
        planPriceSnapshot: true,
        createdAt: true,
      },
    }),
    prisma.payment.groupBy({
      by: ["memberId", "subscriptionId"],
      where: {
        memberId: { in: memberIds },
        status: "SUCCESS",
        subscriptionId: { not: null },
      },
      _sum: { finalAmount: true, discountAmount: true },
    }),
  ])

  for (const row of subTotals) {
    const r = result.get(row.memberId)
    if (!r) continue
    const totalAmount = row._sum.planPriceSnapshot || 0
    r.totalAmount = totalAmount
    r.globalTotalAmount = totalAmount
  }

  const payByMember = new Map<string, { final: number; disc: number }>()
  for (const row of payTotals) {
    payByMember.set(row.memberId, {
      final: row._sum.finalAmount || 0,
      disc: row._sum.discountAmount || 0,
    })
  }

  for (const id of memberIds) {
    const r = result.get(id)!
    const pay = payByMember.get(id) ?? { final: 0, disc: 0 }
    r.totalPaid = pay.final
    r.globalTotalPaid = pay.final
    r.remaining = Math.round(r.totalAmount - (pay.final + pay.disc))
    r.globalRemaining = r.remaining
    r.isPaidFull = r.remaining <= 1
  }

  const ncByMember = new Map<string, typeof nonCancelledSubs>()
  for (const s of nonCancelledSubs) {
    const arr = ncByMember.get(s.memberId) ?? []
    arr.push(s)
    ncByMember.set(s.memberId, arr)
  }
  for (const arr of ncByMember.values()) {
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  const activeByMember = new Map<string, typeof activeSubs>()
  for (const s of activeSubs) {
    const arr = activeByMember.get(s.memberId) ?? []
    arr.push(s)
    activeByMember.set(s.memberId, arr)
  }
  for (const arr of activeByMember.values()) {
    arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  const payLinked = new Map<string, { final: number; disc: number }>()
  for (const row of payBySub) {
    if (row.subscriptionId == null) continue
    payLinked.set(`${row.memberId}|${row.subscriptionId}`, {
      final: row._sum.finalAmount || 0,
      disc: row._sum.discountAmount || 0,
    })
  }

  for (const id of memberIds) {
    const r = result.get(id)
    if (!r) continue
    try {
      const activeList = activeByMember.get(id) ?? []
      const candidates = activeList.slice(0, 24)
      const live =
        candidates.find((s) => subscriptionWindowCoversNow(s.startDate, s.endDate)) ?? null

      const ncSorted = ncByMember.get(id) ?? []
      const latestSubscription = live ?? ncSorted[0] ?? null

      const currentTargetSubId = live?.id ?? latestSubscription?.id ?? null
      const currentPlanAmount = latestSubscription?.planPriceSnapshot || 0

      const pl = currentTargetSubId
        ? payLinked.get(`${id}|${currentTargetSubId}`)
        : undefined
      const currentPlanPaid = pl?.final ?? 0
      const currentPlanDisc = pl?.disc ?? 0
      r.currentPlanAmount = currentPlanAmount
      r.currentPlanPaid = currentPlanPaid
      r.currentPlanRemaining = Math.round(currentPlanAmount - (currentPlanPaid + currentPlanDisc))
    } catch (err) {
      console.error(`[Payment Domain] batch current-plan slice failed for member ${id}`, err)
      r.currentPlanAmount = 0
      r.currentPlanPaid = 0
      r.currentPlanRemaining = 0
    }
  }

  return result
}
