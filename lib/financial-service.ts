import { prisma } from "@/lib/prisma-optimized"

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
  membershipType: string
  startDate: Date
  endDate: Date | null
  status: string
  customPrice: number | null
  lastRenewalAt: Date | null
  createdAt: Date
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
    // Step 1: Fetch member with plan pricing in one query
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: {
        // Include plan pricing to avoid separate query
        _count: {
          select: {
            payments: true
          }
        }
      }
    })

    if (!member || member.status === "DELETED") {
      throw new Error("Member not found")
    }

    console.log(`[Financial Service] Found member: ${member.name}, status: ${member.status}`)

    // Step 2: Get plan price
    const dbPrice = await prisma.planPricing.findUnique({
      where: { membershipType: member.membershipType }
    })
    
    const planPrice = dbPrice?.amount ?? 0
    const totalAmount = member.customPrice ?? planPrice

    console.log(`[Financial Service] Plan price: ${planPrice}, Custom price: ${member.customPrice}, Total amount: ${totalAmount}`)

    // Step 3: Get total paid for CURRENT membership period only
    // Use lastRenewalAt if it exists (exact renewal moment), otherwise fall back to startDate
    const periodStart = member.lastRenewalAt ?? member.startDate
    
    console.log(`[Financial Service] Period start: ${periodStart}, Start date: ${member.startDate}, Last renewal: ${member.lastRenewalAt}`)
    console.log(`[Financial Service] Period start type: ${typeof periodStart}, Start date type: ${typeof member.startDate}`)
    console.log(`[Financial Service] Period start ISO: ${periodStart.toISOString()}`)
    console.log(`[Financial Service] Member joined: ${member.createdAt}, Plan: ${member.membershipType}`)
    
    // Build payment filter based on status
    // Use date field for consistent comparison (ignores time component)
    // IMPORTANT: Use the actual periodStart time, not just the date part
    const paymentWhere: {
      memberId: string
      date: {
        gte: Date
        lte?: Date
      }
    } = {
      memberId: member.id,
      date: { 
        gte: periodStart // Use the full datetime, not just date part
      }
    }
    
    if (member.status === "ACTIVE" && member.endDate) {
      paymentWhere.date = { 
        ...paymentWhere.date,
        lte: new Date(member.endDate.toISOString().split('T')[0]) // Convert back to Date for Prisma
      }
    }

    console.log(`[Financial Service] Payment filter:`, paymentWhere)

    // Step 4: Aggregate payments
    console.log(`[Financial Service] Aggregating payments with filter...`)
    const paymentsSum = await prisma.payment.aggregate({
      where: paymentWhere,
      _sum: {
        amount: true
      }
    })
    
    console.log(`[Financial Service] Payment aggregation result:`, paymentsSum)
    
    // Also fetch individual payments for debugging
    const individualPayments = await prisma.payment.findMany({
      where: paymentWhere,
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        mode: true,
        notes: true
      }
    })
    
    console.log(`[Financial Service] Individual payments found:`, individualPayments)
    
    const totalPaid = paymentsSum._sum.amount ?? 0
    const remaining = totalAmount - totalPaid
    const isPaidFull = remaining <= 0

    console.log(`[Financial Service] Final calculation: Member: ${member.name}, Total: ${totalAmount}, Paid: ${totalPaid}, Remaining: ${remaining}`)

    return {
      totalAmount,
      totalPaid,
      remaining,
      isPaidFull
    }
  } catch (error) {
    console.error(`[Financial Service] Error computing financials for ${memberId}:`, error)
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

  // Step 1: Fetch all members with plan pricing in one query
  const members = await prisma.member.findMany({
    where: { 
      id: { in: memberIds },
      status: { not: "DELETED" }
    }
  })

  // Step 2: Get all plan prices in one query
  const membershipTypes = [...new Set(members.map(m => m.membershipType))]
  const planPrices = await prisma.planPricing.findMany({
    where: { membershipType: { in: membershipTypes } }
  })
  
  const priceMap = new Map(planPrices.map(p => [p.membershipType, p.amount]))

  // Step 3: Get all payments for all members in one query
  const payments = await prisma.payment.findMany({
    where: {
      memberId: { in: memberIds }
    },
    orderBy: { date: 'desc' }
  })

  // Step 4: Group payments by member and filter by period
  const paymentsByMember = new Map<string, number>()
  
  for (const member of members) {
    const periodStart = member.lastRenewalAt ?? member.startDate
    const memberPayments = payments.filter(p => {
      if (p.memberId !== member.id) return false
      
      const paymentDate = p.date.toISOString().split('T')[0]
      const periodStartDate = periodStart.toISOString().split('T')[0]
      
      if (paymentDate < periodStartDate) return false
      
      if (member.status === "ACTIVE" && member.endDate) {
        const endDate = member.endDate.toISOString().split('T')[0]
        return paymentDate <= endDate
      }
      
      return true
    })
    
    const totalPaid = memberPayments.reduce((sum, p) => sum + p.amount, 0)
    paymentsByMember.set(member.id, totalPaid)
  }

  // Step 5: Compute financials for all members
  const financialsMap = new Map<string, MemberFinancials>()
  
  for (const member of members) {
    const planPrice = priceMap.get(member.membershipType) ?? 0
    const totalAmount = member.customPrice ?? planPrice
    const totalPaid = paymentsByMember.get(member.id) ?? 0
    const remaining = totalAmount - totalPaid
    const isPaidFull = remaining <= 0

    financialsMap.set(member.id, {
      totalAmount,
      totalPaid,
      remaining,
      isPaidFull
    })
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
  membershipType: string
  startDate: Date
  endDate: Date | null
  status: string
  customPrice: number | null
  lastRenewalAt: Date | null
  createdAt: Date
}[]): Promise<MemberWithFinancials[]> {
  const memberIds = members.map(m => m.id)
  const financialsMap = await computeMultipleMembersFinancials(memberIds)
  
  return members.map(member => {
    const financials = financialsMap.get(member.id)
    if (!financials) {
      throw new Error(`Financials not found for member ${member.id}`)
    }
    return {
      ...member,
      ...financials
    }
  })
}
