import { getMemberSubscriptionFinancialSummary } from "./payment"
import { findLiveSubscription, getActiveSubscription } from "./subscription"
import { isMembershipEndPast } from "@/lib/gym-datetime"
import { prisma } from "@/lib/prisma"

export type MemberOperationalState = "ACTIVE" | "EXPIRED" | "CANCELLED" | "INACTIVE"

export type MemberStatusSnapshot = {
  memberId: string
  status: MemberOperationalState
  subscription: {
    id: string
    planName: string
    planPrice: number
    startDate: Date
    endDate: Date
    status: "ACTIVE" | "EXPIRED" | "CANCELLED"
  } | null
  financial: {
    totalAmount: number
    totalPaid: number
    remaining: number
    isPaidFull: boolean
  }
  hasActiveSubscription: boolean
}

export type MemberPlanUiState = "LIVE" | "CANCELLED" | "EXPIRED" | "NEEDS_PLAN"

export type MemberPlanStateSnapshot = {
  planUiState: MemberPlanUiState
  displaySubscription: {
    id: string
    planNameSnapshot: string
    planPriceSnapshot: number
    startDate: Date
    endDate: Date
    status: "ACTIVE" | "EXPIRED" | "CANCELLED"
  } | null
}

/**
 * Canonical member status snapshot for APIs that need status + subscription + financial overview.
 */
export async function getMemberStatusSnapshot(memberId: string): Promise<MemberStatusSnapshot> {
  const activeSubscription = await getActiveSubscription(memberId)
  const financialSummary = await getMemberSubscriptionFinancialSummary(memberId)

  let status: MemberOperationalState = "INACTIVE"
  let subscription: MemberStatusSnapshot["subscription"] = null

  if (activeSubscription) {
    const now = new Date()
    if (activeSubscription.status === "ACTIVE" && activeSubscription.endDate >= now) {
      status = "ACTIVE"
    } else if (activeSubscription.status === "ACTIVE" && activeSubscription.endDate < now) {
      status = "EXPIRED"
    } else if (activeSubscription.status === "CANCELLED") {
      status = "CANCELLED"
    }

    subscription = {
      id: activeSubscription.id,
      planName: activeSubscription.planNameSnapshot,
      planPrice: activeSubscription.planPriceSnapshot,
      startDate: activeSubscription.startDate,
      endDate: activeSubscription.endDate,
      status: activeSubscription.status,
    }
  }

  return {
    memberId,
    status,
    subscription,
    financial: {
      totalAmount: financialSummary.totalAmount,
      totalPaid: financialSummary.totalPaid,
      remaining: financialSummary.remaining,
      isPaidFull: financialSummary.isPaidFull,
    },
    hasActiveSubscription: !!activeSubscription,
  }
}

/**
 * Canonical UI plan state derivation for member profile.
 */
export async function deriveMemberPlanState(memberId: string): Promise<MemberPlanStateSnapshot> {
  const recentSubs = await prisma.subscription.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take: 24,
  })

  const latestSub = recentSubs[0] ?? null
  const liveSub = await findLiveSubscription(memberId)

  let planUiState: MemberPlanUiState = "NEEDS_PLAN"
  let displaySub: (typeof recentSubs)[0] | null = null

  if (liveSub) {
    planUiState = "LIVE"
    displaySub = liveSub
  } else if (!latestSub) {
    planUiState = "NEEDS_PLAN"
    displaySub = null
  } else if (latestSub.status === "CANCELLED") {
    planUiState = "CANCELLED"
    displaySub = latestSub
  } else if (isMembershipEndPast(latestSub.endDate)) {
    planUiState = "EXPIRED"
    displaySub =
      recentSubs
        .filter((s) => s.status !== "CANCELLED" && isMembershipEndPast(s.endDate))
        .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? latestSub
  } else {
    planUiState = "NEEDS_PLAN"
    displaySub = latestSub
  }

  return {
    planUiState,
    displaySubscription: displaySub
      ? {
          id: displaySub.id,
          planNameSnapshot: displaySub.planNameSnapshot,
          planPriceSnapshot: displaySub.planPriceSnapshot,
          startDate: displaySub.startDate,
          endDate: displaySub.endDate,
          status: displaySub.status,
        }
      : null,
  }
}
