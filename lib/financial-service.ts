import type { Prisma } from "@prisma/client"
import {
  batchGetMemberListFinancialSummaries,
  getMemberSubscriptionFinancialSummary,
  type MemberListFinancialSummary,
} from "../domain/payment"
import {
  computeMemberPlanStateFromSubscriptions,
  type MemberPlanStateSnapshot,
} from "../domain/member-status"
import { subscriptionWindowCoversNow } from "./gym-datetime"

/** Prisma select for GET /api/members list rows (single source for typing + queries). */
export const membersListSelect = {
  id: true,
  name: true,
  phone: true,
  status: true,
  createdAt: true,
  lastCheckinAt: true,
  updatedAt: true,
  subscriptions: {
    orderBy: { createdAt: "desc" as const },
    take: 24,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      planNameSnapshot: true,
      planPriceSnapshot: true,
      createdAt: true,
    },
  },
} satisfies Prisma.MemberSelect

export type MemberListQueryRow = Prisma.MemberGetPayload<{
  select: typeof membersListSelect
}>

export function emptyMemberFinancials(): MemberFinancials {
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

export interface MemberFinancials {
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

export type MemberWithFinancials = MemberListQueryRow &
  MemberFinancials & {
    planUiState: MemberPlanStateSnapshot["planUiState"]
    displaySubscription: MemberPlanStateSnapshot["displaySubscription"]
  }

/**
 * Single source of truth for all financial computations
 * This is the ONLY place where financial logic should exist
 */
export async function computeMemberFinancials(memberId: string): Promise<MemberFinancials> {
  console.log(`[Financial Service] Computing financials for member: ${memberId}`)
  
  try {
    // Use domain functions for financial calculations
    const financialSummary = await getMemberSubscriptionFinancialSummary(memberId)
    
    return {
      totalAmount: financialSummary.totalAmount,
      totalPaid: financialSummary.totalPaid,
      remaining: financialSummary.remaining,
      isPaidFull: financialSummary.isPaidFull,
      globalTotalAmount: financialSummary.globalTotalAmount,
      globalTotalPaid: financialSummary.globalTotalPaid,
      globalRemaining: financialSummary.globalRemaining,
      currentPlanAmount: financialSummary.currentPlanAmount,
      currentPlanPaid: financialSummary.currentPlanPaid,
      currentPlanRemaining: financialSummary.currentPlanRemaining,
    }
  } catch (error) {
    console.error(`[Financial Service] Error computing financials for member: ${memberId}`, error)
    throw error
  }
}

function ledgerSummaryToFinancials(row: MemberListFinancialSummary): MemberFinancials {
  return { ...row }
}

function summaryToFinancials(
  s: Awaited<ReturnType<typeof getMemberSubscriptionFinancialSummary>>
): MemberFinancials {
  return {
    totalAmount: s.totalAmount,
    totalPaid: s.totalPaid,
    remaining: s.remaining,
    isPaidFull: s.isPaidFull,
    globalTotalAmount: s.globalTotalAmount,
    globalTotalPaid: s.globalTotalPaid,
    globalRemaining: s.globalRemaining,
    currentPlanAmount: s.currentPlanAmount,
    currentPlanPaid: s.currentPlanPaid,
    currentPlanRemaining: s.currentPlanRemaining,
  }
}

/**
 * Attach financials to list rows. Batch load with per-member isolation: batch failure
 * falls back to per-member summaries; each member errors map to empty financials.
 */
export async function attachFinancialsToMembers(
  members: MemberListQueryRow[]
): Promise<MemberWithFinancials[]> {
  if (members.length === 0) return []

  const ids = members.map((m) => m.id)
  let batch: Map<string, MemberFinancials>

  try {
    const raw = await batchGetMemberListFinancialSummaries(ids)
    batch = new Map(
      Array.from(raw.entries()).map(([id, row]) => [id, ledgerSummaryToFinancials(row)])
    )
  } catch (batchErr) {
    console.error(
      "[Financial Service] batchGetMemberListFinancialSummaries failed; using per-member fallback",
      batchErr
    )
    batch = new Map()
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          const s = await getMemberSubscriptionFinancialSummary(id)
          return [id, summaryToFinancials(s)] as const
        } catch (err) {
          console.error(`[Financial Service] member ${id} financial summary failed`, err)
          return [id, emptyMemberFinancials()] as const
        }
      })
    )
    for (const [id, fin] of entries) {
      batch.set(id, fin)
    }
  }

  return members.map((member) => {
    const financials = batch.get(member.id) ?? emptyMemberFinancials()
    const liveSub =
      member.subscriptions.find(
        (sub) => sub.status === "ACTIVE" && subscriptionWindowCoversNow(sub.startDate, sub.endDate)
      ) ?? null
    const { planUiState, displaySub } = computeMemberPlanStateFromSubscriptions(
      member.subscriptions,
      liveSub
    )

    return {
      ...member,
      ...financials,
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
  })
}
