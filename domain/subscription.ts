import { prisma } from "../lib/prisma"
import { isMembershipEndPast, subscriptionWindowCoversNow } from "../lib/gym-datetime"
import type { Prisma } from "@prisma/client"

type DbClient = typeof prisma | Prisma.TransactionClient
type MemberStatus = "ACTIVE" | "INACTIVE" | "DELETED"

export interface Subscription {
  id: string
  memberId: string
  planId: string
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
  planNameSnapshot: string
  planPriceSnapshot: number
  createdAt: Date
}

export interface Plan {
  id: string
  name: string
  durationDays: number
  price: number
  isActive: boolean
  createdAt: Date
}

/**
 * Get the currently active subscription for a member
 * BUSINESS RULE: Only ONE active subscription per member
 */
export async function findLiveSubscription(
  memberId: string,
  db: DbClient = prisma
): Promise<Subscription | null> {
  const candidates = await db.subscription.findMany({
    where: { memberId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 24,
  })

  const subscription = candidates.find((s) =>
    subscriptionWindowCoversNow(s.startDate, s.endDate)
  )

  return subscription || null
}

/** Any ACTIVE subscription whose IST end day has not passed (includes future-dated starts). */
export async function hasActiveSubscriptionNotEnded(
  memberId: string,
  db: DbClient = prisma
): Promise<boolean> {
  const rows = await db.subscription.findMany({
    where: { memberId, status: "ACTIVE" },
    select: { endDate: true },
  })
  return rows.some((s) => !isMembershipEndPast(s.endDate))
}

/**
 * Sync member operational status from live subscription coverage.
 * DELETED is preserved and never auto-changed.
 */
export async function syncMemberOperationalStatus(
  memberId: string,
  db: DbClient = prisma
): Promise<MemberStatus> {
  const member = await db.member.findUnique({
    where: { id: memberId },
    select: { status: true },
  })

  if (!member) {
    throw new Error("Member not found")
  }

  if (member.status === "DELETED") {
    return "DELETED"
  }

  const liveSub = await findLiveSubscription(memberId, db)
  const hasPlanOnFile =
    liveSub != null || (await hasActiveSubscriptionNotEnded(memberId, db))
  const nextStatus: MemberStatus = hasPlanOnFile ? "ACTIVE" : "INACTIVE"

  if (member.status !== nextStatus) {
    await db.member.update({
      where: { id: memberId },
      data: { status: nextStatus },
    })
  }

  return nextStatus
}

/**
 * Reconcile stale ACTIVE rows whose end-day has passed in IST.
 */
export async function reconcileExpiredSubscriptions(
  db: DbClient = prisma
): Promise<{ examined: number; expired: number; memberIds: string[] }> {
  const activeSubs = await db.subscription.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, memberId: true, endDate: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  })

  const expiredIds = activeSubs.filter((s) => isMembershipEndPast(s.endDate)).map((s) => s.id)
  const memberIds = Array.from(
    new Set(activeSubs.filter((s) => expiredIds.includes(s.id)).map((s) => s.memberId))
  )

  if (expiredIds.length > 0) {
    await db.subscription.updateMany({
      where: { id: { in: expiredIds } },
      data: { status: "EXPIRED" },
    })
  }

  return {
    examined: activeSubs.length,
    expired: expiredIds.length,
    memberIds,
  }
}

export async function getActiveSubscription(memberId: string): Promise<Subscription | null> {
  console.log(`[Subscription Domain] Getting active subscription for member: ${memberId}`)

  const subscription = await findLiveSubscription(memberId)

  if (!subscription) {
    console.log(`[Subscription Domain] No active subscription found for member: ${memberId}`)
    return null
  }

  console.log(`[Subscription Domain] Found active subscription: ${subscription.id}`)
  return subscription
}

/**
 * Create a new subscription for a member
 * BUSINESS RULE: Custom price per subscription (preserves pricing history)
 */
export async function createSubscription(
  memberId: string, 
  planId: string,
  customPrice?: number
): Promise<Subscription> {
  return createSubscriptionWithDate(memberId, planId, customPrice)
}

/**
 * Create subscription with controlled start date (for renewals)
 * BUSINESS RULE: startDate = max(now, currentSubscription.endDate) - NO OVERLAPS
 */
export async function createSubscriptionWithDate(
  memberId: string, 
  planId: string,
  customPrice?: number,
  forceStartDate?: Date
): Promise<Subscription> {
  console.log(`[Subscription Domain] Creating subscription for member: ${memberId}, plan: ${planId}`)
  
  // Get plan details
  const plan = await prisma.plan.findUnique({
    where: { id: planId, isActive: true }
  })

  if (!plan) {
    throw new Error(`Plan not found or inactive: ${planId}`)
  }

  // Get current subscription to calculate start date
  const currentSubscription = await getActiveSubscription(memberId)
  
  // BUSINESS RULE: No overlap - start after current ends or now if no current
  const now = new Date()
  const earliestStart = forceStartDate || now
  const startDate = currentSubscription 
    ? new Date(Math.max(earliestStart.getTime(), currentSubscription.endDate.getTime()))
    : earliestStart

  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + plan.durationDays)

  console.log(`[Subscription Domain] Plan: ${plan.name}, Duration: ${plan.durationDays} days`)
  console.log(`[Subscription Domain] Subscription period: ${startDate.toISOString()} to ${endDate.toISOString()}`)
  console.log(`[Subscription Domain] Current subscription ends: ${currentSubscription?.endDate?.toISOString() || 'None'}`)

  // Create subscription with snapshot
  const subscription = await prisma.subscription.create({
    data: {
      memberId,
      planId,
      startDate,
      endDate,
      status: 'ACTIVE',
      planNameSnapshot: plan.name,
      planPriceSnapshot: customPrice || plan.price
    },
    include: {
      plan: true
    }
  })

  console.log(`[Subscription Domain] Created subscription: ${subscription.id}`)
  return subscription
}

/**
 * Renewal logic - creates new subscription when existing one expires
 * BUSINESS RULE: Only ONE active subscription per member
 * RULE: startDate = max(now, currentSubscription.endDate) - NO OVERLAPS
 */
export async function renewSubscription(
  memberId: string,
  newPlanId?: string,
  customPrice?: number
): Promise<Subscription> {
  console.log(`[Subscription Domain] Renewing subscription for member: ${memberId}`)
  
  // Get current active subscription
  const currentSubscription = await getActiveSubscription(memberId)
  
  // Determine which plan to use
  let planId = newPlanId
  if (!planId && currentSubscription) {
    planId = currentSubscription.planId
  }
  if (!planId) {
    throw new Error('No plan specified and no current subscription found')
  }

  // Deactivate current subscription if exists
  if (currentSubscription) {
    console.log(`[Subscription Domain] Deactivating current subscription: ${currentSubscription.id}`)
    
    await prisma.subscription.update({
      where: { id: currentSubscription.id },
      data: { 
        status: 'EXPIRED',
        endDate: new Date() // End it today
      }
    })
  }

  // Create new subscription with NO OVERLAP rule
  const newSubscription = await createSubscriptionWithDate(memberId, planId, customPrice)
  
  console.log(`[Subscription Domain] Renewal complete. New subscription: ${newSubscription.id}`)
  return newSubscription
}

/**
 * Get all subscriptions for a member (for history)
 */
export async function getMemberSubscriptionHistory(memberId: string): Promise<Subscription[]> {
  console.log(`[Subscription Domain] Getting subscription history for member: ${memberId}`)
  
  const subscriptions = await prisma.subscription.findMany({
    where: { memberId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  })

  console.log(`[Subscription Domain] Found ${subscriptions.length} subscriptions`)
  return subscriptions
}

/**
 * Get subscription expiry information with grace period
 * BUSINESS RULE: Grace period is derived, not stored in subscription
 * IMPLEMENTATION: Subscription = strict truth, Grace = derived logic
 */
export async function getSubscriptionExpiry(
  memberId: string, 
  graceDays: number = 3 // Configurable via Setting
): Promise<{
  isExpired: boolean
  isInGrace: boolean
  daysRemaining: number
  graceDaysRemaining: number
  expiryDate: Date | null
}> {
  const activeSubscription = await getActiveSubscription(memberId)
  
  if (!activeSubscription) {
    return {
      isExpired: true,
      isInGrace: false,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      expiryDate: null
    }
  }

  const now = new Date()
  const expiryDate = activeSubscription.endDate
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const graceEndDate = new Date(expiryDate.getTime() + (graceDays * 24 * 60 * 60 * 1000))
  const graceDaysRemaining = Math.ceil((graceEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  return {
    isExpired: daysRemaining <= 0,
    isInGrace: daysRemaining <= 0 && graceDaysRemaining > 0,
    daysRemaining: Math.max(0, daysRemaining),
    graceDaysRemaining: Math.max(0, graceDaysRemaining),
    expiryDate
  }
}

/**
 * Update subscription status (for manual overrides)
 * BUSINESS RULE: System derives ACTIVE/EXPIRED from dates, Admin can set CANCELLED
 */
export async function updateSubscriptionStatus(
  subscriptionId: string,
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
): Promise<void> {
  console.log(`[Subscription Domain] Updating subscription ${subscriptionId} status to: ${status}`)
  
  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status }
  })
}

/**
 * Get grace period from settings
 */
export async function getGracePeriodDays(): Promise<number> {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'grace_period_days' }
    })
    return setting?.value as number || 3 // Default to 3 days
  } catch {
    return 3 // Fallback
  }
}

/**
 * Get all subscriptions for a member (for history)
 * OLD LOGIC: Only had current membership in Member table
 * NEW LOGIC: Full subscription history
 */
