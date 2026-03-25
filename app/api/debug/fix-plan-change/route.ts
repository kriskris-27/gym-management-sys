import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, newPlan } = await request.json()
    
    console.log(`\n=== FIX PLAN CHANGE ISSUE ===`)
    console.log(`Member: ${memberId}`)
    console.log(`New Plan: ${newPlan}`)
    
    // Get current member state
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true
      }
    })
    
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    
    console.log(`Before: ${member.name} - ${member.membershipType} (₹${member.customPrice})`)
    console.log(`Before lastRenewalAt: ${member.lastRenewalAt}`)
    
    // Get plan pricing
    const planPricing = await prisma.planPricing.findUnique({
      where: { membershipType: newPlan }
    })
    
    const newPrice = planPricing?.amount || 0
    
    // Set lastRenewalAt to day after tomorrow to exclude ALL current payments
    const dayAfterTomorrow = new Date()
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    dayAfterTomorrow.setHours(0, 0, 0, 0)
    
    console.log(`Setting lastRenewalAt to day after tomorrow: ${dayAfterTomorrow.toISOString()}`)
    
    // Update member with new plan and reset payment cycle
    const updatedMember = await prisma.member.update({
      where: { id: memberId },
      data: {
        membershipType: newPlan,
        customPrice: newPrice,
        lastRenewalAt: dayAfterTomorrow, // This excludes all current payments
        endDate: newPlan === "HALF_YEARLY" 
          ? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) // 180 days for half yearly
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days for monthly
      }
    })
    
    console.log(`After: ${updatedMember.name} - ${updatedMember.membershipType} (₹${updatedMember.customPrice})`)
    console.log(`After lastRenewalAt: ${updatedMember.lastRenewalAt}`)
    
    // Test financial calculation
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials after fix:`, financials)
    console.log(`=== END PLAN CHANGE FIX ===\n`)
    
    return NextResponse.json({
      success: true,
      message: "Plan changed and payment cycle reset successfully",
      before: {
        plan: member.membershipType,
        price: member.customPrice,
        lastRenewalAt: member.lastRenewalAt
      },
      after: {
        plan: updatedMember.membershipType,
        price: updatedMember.customPrice,
        lastRenewalAt: updatedMember.lastRenewalAt
      },
      financials
    })
    
  } catch (error) {
    console.error("[Fix Plan Change] Error:", error)
    return NextResponse.json({ error: "Failed to fix plan change" }, { status: 500 })
  }
}
