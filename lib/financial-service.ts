import { prisma } from "./prisma"
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
 * Optimized Batch version for performance - FIXES N+1
 * Aggregates all subscription prices and payments for multiple members in only 2 queries.
 */
export async function computeMultipleMembersFinancials(memberIds: string[]): Promise<Map<string, MemberFinancials>> {
  if (memberIds.length === 0) {
    return new Map()
  }

  console.log(`[Financial Service] Batch computing financials for ${memberIds.length} members`)

  // 1. Bulk Aggregate Revenue (from Subscriptions)
  const subscriptions = await prisma.subscription.groupBy({
    by: ['memberId'],
    where: { 
      memberId: { in: memberIds },
      status: { not: 'CANCELLED' }
    },
    _sum: {
      planPriceSnapshot: true
    }
  })

  // 2. Bulk Aggregate Payments & Discounts
  const payments = await prisma.payment.groupBy({
    by: ['memberId'],
    where: {
      memberId: { in: memberIds },
      status: 'SUCCESS'
    },
    _sum: {
      finalAmount: true,
      discountAmount: true
    }
  })

  // 3. Map outcomes for efficient lookup
  const financialsMap = new Map<string, MemberFinancials>()
  
  // Initialize map with zeros for all requested IDs
  memberIds.forEach(id => {
    financialsMap.set(id, {
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
    })
  })

  // Merge Revenue
  subscriptions.forEach(sub => {
    const data = financialsMap.get(sub.memberId)!
    data.totalAmount = sub._sum.planPriceSnapshot || 0
    data.globalTotalAmount = data.totalAmount
    data.currentPlanAmount = data.totalAmount
  })

  // Merge Payments and compute final state
  payments.forEach(pay => {
    const data = financialsMap.get(pay.memberId)!
    data.totalPaid = pay._sum.finalAmount || 0
    data.globalTotalPaid = data.totalPaid
    data.currentPlanPaid = data.totalPaid
    // Internal tracking for discount
    ;(data as any).totalDiscount = pay._sum.discountAmount || 0
  })

  // Final Pass to compute remaining/paid-full logic consistently
  financialsMap.forEach((data) => {
    const disc = (data as any).totalDiscount || 0
    data.remaining = Math.round(data.totalAmount - (data.totalPaid + disc))
    data.globalRemaining = data.remaining
    data.currentPlanRemaining = data.remaining
    data.isPaidFull = data.remaining <= 1 // ₹1 tolerance consistent with domain
  })

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
        isPaidFull: false,
        globalTotalAmount: 0,
        globalTotalPaid: 0,
        globalRemaining: 0,
        currentPlanAmount: 0,
        currentPlanPaid: 0,
        currentPlanRemaining: 0,
      }
    }
    return {
      ...member,
      ...financials
    }
  })
}
