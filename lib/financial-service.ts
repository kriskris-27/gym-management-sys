import { getMemberSubscriptionFinancialSummary } from "../domain/payment"

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

export interface MemberWithFinancials {
  id: string
  name: string
  phone: string
  status: string
  lastCheckinAt: Date | null
  createdAt: Date
  updatedAt: Date
  // Financial fields
  totalAmount: number
  totalPaid: number
  remaining: number
  isPaidFull: boolean
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

/**
 * Helper to attach financials to member objects
 */
export async function attachFinancialsToMembers(members: {
  id: string
  name: string
  phone: string
  status: string
  lastCheckinAt: Date | null
  createdAt: Date
  updatedAt: Date
}[]): Promise<MemberWithFinancials[]> {
  if (members.length === 0) return []

  const withFinance = await Promise.all(
    members.map(async (member) => {
      const financials = await computeMemberFinancials(member.id)
      return { ...member, ...financials }
    })
  )

  return withFinance
}
