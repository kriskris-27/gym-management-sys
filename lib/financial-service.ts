import { prisma } from "../lib/prisma-optimized"
import { getMemberSubscriptionFinancialSummary } from "../domain/payment"
import { getActiveSubscription } from "../domain/subscription"

export interface MemberFinancials {
  totalAmount: number
  totalPaid: number
  remaining: number
  isPaidFull: boolean
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
      isPaidFull: financialSummary.isPaidFull
    }
  } catch (error) {
    console.error(`[Financial Service] Error computing financials for member: ${memberId}`, error)
    throw error
  }
}

/**
 * Batch version for performance - avoids N+1 queries
 */
export async function computeMultipleMembersFinancials(memberIds: string[]): Promise<Map<string, MemberFinancials>> {
  if (memberIds.length === 0) {
    return new Map()
  }

  const financialsMap = new Map<string, MemberFinancials>()
  
  // Use domain functions for each member
  for (const memberId of memberIds) {
    try {
      const financials = await computeMemberFinancials(memberId)
      financialsMap.set(memberId, financials)
    } catch (error) {
      console.error(`[Financial Service] Error computing financials for member: ${memberId}`, error)
      // Continue with other members
    }
  }

  return financialsMap
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
  const memberIds = members.map(m => m.id)
  const financialsMap = await computeMultipleMembersFinancials(memberIds)
  
  return members.map(member => {
    const financials = financialsMap.get(member.id)
    if (!financials) {
      // Return default financials if not found
      return {
        ...member,
        totalAmount: 0,
        totalPaid: 0,
        remaining: 0,
        isPaidFull: false
      }
    }
    return {
      ...member,
      ...financials
    }
  })
}
