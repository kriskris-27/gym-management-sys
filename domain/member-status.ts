import { findLiveSubscription } from "./subscription"
import { isMembershipEndPast } from "@/lib/gym-datetime"
import { prisma } from "@/lib/prisma"
import type { Subscription } from "./subscription"

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

type SubscriptionRow = Pick<
  Subscription,
  | "id"
  | "planNameSnapshot"
  | "planPriceSnapshot"
  | "startDate"
  | "endDate"
  | "status"
  | "createdAt"
>

export function computeMemberPlanStateFromSubscriptions(
  recentSubs: SubscriptionRow[],
  liveSub: SubscriptionRow | null
): { planUiState: MemberPlanUiState; displaySub: SubscriptionRow | null } {
  const latestSub = recentSubs[0] ?? null

  if (liveSub) {
    return { planUiState: "LIVE", displaySub: liveSub }
  }

  // ACTIVE row with end not yet passed in IST, but "now" is outside [start,end] (e.g. plan
  // starts tomorrow). Still on a plan — not NEEDS_PLAN / Renew.
  const activeNotEnded = recentSubs.filter(
    (s) => s.status === "ACTIVE" && !isMembershipEndPast(s.endDate)
  )
  if (activeNotEnded.length > 0) {
    return { planUiState: "LIVE", displaySub: activeNotEnded[0] }
  }
  if (!latestSub) {
    return { planUiState: "NEEDS_PLAN", displaySub: null }
  }
  if (latestSub.status === "CANCELLED") {
    return { planUiState: "CANCELLED", displaySub: latestSub }
  }
  if (isMembershipEndPast(latestSub.endDate)) {
    const displaySub =
      recentSubs
        .filter((s) => s.status !== "CANCELLED" && isMembershipEndPast(s.endDate))
        .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? latestSub
    return { planUiState: "EXPIRED", displaySub }
  }

  return { planUiState: "NEEDS_PLAN", displaySub: latestSub }
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

  const liveSub = await findLiveSubscription(memberId)
  const { planUiState, displaySub } = computeMemberPlanStateFromSubscriptions(recentSubs, liveSub)

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
