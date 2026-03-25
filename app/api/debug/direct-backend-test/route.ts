import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, newPlan } = await request.json()
    
    console.log(`\n=== DIRECT BACKEND PLAN CHANGE TEST ===`)
    
    // Get current member
    const existingMember = await prisma.member.findUnique({
      where: { id: memberId }
    })
    
    if (!existingMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    
    console.log(`Before: ${existingMember.name} - ${existingMember.membershipType}`)
    
    // Get plan pricing
    const planPricing = await prisma.planPricing.findUnique({
      where: { membershipType: newPlan }
    })
    
    const newPrice = planPricing?.amount || 0
    
    // Apply the exact same logic as the PUT API
    const futureTime = new Date()
    futureTime.setDate(futureTime.getDate() + 7)
    futureTime.setHours(23, 59, 59, 999)
    
    const updateData = {
      membershipType: newPlan,
      customPrice: newPrice,
      lastRenewalAt: futureTime
    }
    
    // Calculate new end date
    if (newPlan !== "PERSONAL_TRAINING") {
      const daysMap = {
        MONTHLY: 30,
        QUARTERLY: 90,
        HALF_YEARLY: 180,
        ANNUAL: 365,
      }
      const daysToAdd = daysMap[newPlan as keyof typeof daysMap] || 30
      const newEndDate = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000)
      updateData.endDate = newEndDate
    }
    
    console.log(`Updating with:`, updateData)
    
    // Update member
    const updatedMember = await prisma.member.update({
      where: { id: memberId },
      data: updateData
    })
    
    console.log(`After: ${updatedMember.name} - ${updatedMember.membershipType} (₹${updatedMember.customPrice})`)
    console.log(`New lastRenewalAt: ${updatedMember.lastRenewalAt}`)
    
    // Test financial calculation
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials:`, financials)
    console.log(`=== END DIRECT BACKEND TEST ===\n`)
    
    return NextResponse.json({
      success: true,
      before: {
        plan: existingMember.membershipType,
        price: existingMember.customPrice,
        lastRenewalAt: existingMember.lastRenewalAt
      },
      after: {
        plan: updatedMember.membershipType,
        price: updatedMember.customPrice,
        lastRenewalAt: updatedMember.lastRenewalAt
      },
      financials,
      paymentCycleReset: financials.totalPaid === 0
    })
    
  } catch (error) {
    console.error("[Direct Backend Test] Error:", error)
    return NextResponse.json({ error: "Test failed" }, { status: 500 })
  }
}
