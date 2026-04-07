import { findLiveSubscription } from "./subscription"
import { isMembershipEndPast } from "@/lib/gym-datetime"
import { prisma } from "@/lib/prisma"

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
  } else {
    // ACTIVE row with end not yet passed in IST, but "now" is outside [start,end] (e.g. plan
    // starts tomorrow). Still on a plan — not NEEDS_PLAN / Renew.
    const activeNotEnded = recentSubs.filter(
      (s) => s.status === "ACTIVE" && !isMembershipEndPast(s.endDate)
    )
    if (activeNotEnded.length > 0) {
      planUiState = "LIVE"
      displaySub = activeNotEnded[0]
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
