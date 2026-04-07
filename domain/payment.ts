import type { Prisma } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { findLiveSubscription, getActiveSubscription } from "./subscription"

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

const RUPEE_ROUND_SLACK = 1

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

/** Block any payment that would exceed total member liability (all non-cancelled subs). */
export function assertGlobalPaymentAllowed(args: {
  amount: number
  globalRemaining: number
}): { ok: true } | { ok: false; code: string; message: string } {
  const pay = Math.round(args.amount)
  const rem = args.globalRemaining
  if (rem <= RUPEE_ROUND_SLACK && pay > 0) {
    return {
      ok: false,
      code: "MEMBER_FULLY_PAID",
      message:
        "This member has no outstanding balance on the ledger. Remove or reduce the amount.",
    }
  }
  if (pay > rem + RUPEE_ROUND_SLACK) {
    return {
      ok: false,
      code: "OVERPAY_GLOBAL",
      message: `Amount (₹${pay}) exceeds total remaining balance (₹${Math.max(0, rem)}).`,
    }
  }
  return { ok: true }
}

export function assertNoCurrentPlanOverpay(args: {
  amount: number
  remaining: number
}): { ok: true } | { ok: false; code: string; message: string } {
  const pay = Math.round(args.amount)
  const rem = args.remaining
  if (rem <= RUPEE_ROUND_SLACK && pay > 0) {
    return {
      ok: false,
      code: "CURRENT_PLAN_FULLY_PAID",
      message:
        "This membership is already fully paid. You cannot record another payment against the current plan.",
    }
  }
  if (pay > rem + RUPEE_ROUND_SLACK) {
    return {
      ok: false,
      code: "OVERPAY_CURRENT_PLAN",
      message: `Amount (₹${pay}) is more than the balance for the current plan (₹${rem}).`,
    }
  }
  return { ok: true }
}

// Import interfaces from subscription domain
interface Subscription {
  id: string
  memberId: string
  planId: string
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
  planNameSnapshot: string
  planPriceSnapshot: number
  createdAt: Date
  plan?: Plan
}

interface Plan {
  id: string
  name: string
  durationDays: number
  price: number
  isActive: boolean
  createdAt: Date
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

  // Calculate total discount
  let totalDiscount = 0
  let discountReason = ''

  // Member-specific discount (percentage)
  if (memberDiscountPercent && memberDiscountPercent > 0) {
    const memberDiscount = Math.round(baseAmount * (memberDiscountPercent / 100))
    totalDiscount += memberDiscount
    discountReason += `Member ${memberDiscountPercent}% off, `
  }

  // Additional flat discount
  if (additionalDiscount && additionalDiscount > 0) {
    totalDiscount += additionalDiscount
    discountReason += `Additional ₹${additionalDiscount} off, `
  }

  // Apply discount caps (percentage + absolute)
  const maxDiscountPercent = 50 // 50% max discount
  const maxDiscountAbsolute = Math.round(baseAmount * 0.5) // Max 50% of plan price
  
  const percentageCap = Math.round(baseAmount * (maxDiscountPercent / 100))
  const finalDiscountCap = Math.min(percentageCap, maxDiscountAbsolute)
  
  // Ensure discount doesn't exceed caps
  totalDiscount = Math.min(totalDiscount, finalDiscountCap)

  const finalAmount = baseAmount - totalDiscount
  console.log(`[Payment Domain] Base: ${baseAmount}, Discount: ${totalDiscount}, Final: ${finalAmount}`)
  console.log(`[Payment Domain] Discount caps applied: Percentage(${percentageCap}), Absolute(${maxDiscountAbsolute}), Final(${finalDiscountCap})`)

  return {
    baseAmount,
    discountAmount: totalDiscount,
    finalAmount,
    discountReason: discountReason.trim() || undefined
  }
}

/**
 * Validate payment amount (controlled validation)
 * BUSINESS RULE: Never "trust admin blindly"
 * FINAL RULE: Payment must satisfy business constraints
 */
export function validatePaymentAmount(
  baseAmount: number,
  finalAmount: number,
  purpose: 'SUBSCRIPTION' | 'ADJUSTMENT' = 'SUBSCRIPTION'
): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Rule 1: Final amount must be non-negative
  if (finalAmount < 0) {
    errors.push('Final amount cannot be negative')
  }

  // Rule 2: Final amount cannot exceed base amount (for subscriptions)
  if (purpose === 'SUBSCRIPTION' && finalAmount > baseAmount) {
    errors.push('Subscription payment cannot exceed base amount')
  }

  // Rule 3: Final amount must be reasonable
  if (finalAmount > 99999) {
    errors.push('Payment amount exceeds maximum limit')
  }

  // Rule 4: Check for suspiciously low amounts
  if (finalAmount > 0 && finalAmount < baseAmount * 0.1) {
    warnings.push('Payment amount is suspiciously low (less than 10% of base amount)')
  }

  // Rule 5: Check for rounding issues
  if (finalAmount > 0 && finalAmount % 1 !== 0) {
    warnings.push('Payment amount has decimal places - consider rounding')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
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
  purpose: 'SUBSCRIPTION' | 'ADJUSTMENT' = 'SUBSCRIPTION',
  notes?: string
): Promise<Payment> {
  console.log(`[Payment Domain] Creating payment for member: ${memberId}, subscription: ${subscriptionId}`)

  // Validate payment amount before creation
  const validation = validatePaymentAmount(calculation.baseAmount, calculation.finalAmount, purpose)
  
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

  const where: any = { memberId }
  
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

  // 1. Get Active Subscription (if any) for current status display
  const activeSubscription = await getActiveSubscription(memberId)

  const { totalAmount, totalPaid, remaining, isPaidFull } = await computeGlobalMemberLedger(memberId)

  const latestSubscription = activeSubscription || await prisma.subscription.findFirst({
    where: { memberId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: 'desc' }
  })

  const currentTargetSubId = activeSubscription?.id || latestSubscription?.id
  const currentPlanAmount = latestSubscription?.planPriceSnapshot || 0
  const currentPlanPaymentSummary = currentTargetSubId
    ? await prisma.payment.aggregate({
        where: { memberId, subscriptionId: currentTargetSubId, status: "SUCCESS" },
        _sum: { finalAmount: true, discountAmount: true },
      })
    : { _sum: { finalAmount: 0, discountAmount: 0 } as { finalAmount: number; discountAmount: number } }
  const currentPlanPaid = currentPlanPaymentSummary._sum.finalAmount || 0
  const currentPlanDiscount = currentPlanPaymentSummary._sum.discountAmount || 0
  const currentPlanRemaining = Math.round(currentPlanAmount - (currentPlanPaid + currentPlanDiscount))

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
