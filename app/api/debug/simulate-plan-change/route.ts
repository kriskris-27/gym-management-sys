import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, newPlan, newPrice } = await request.json()
    
    console.log(`\n=== SIMULATE PLAN CHANGE ===`)
    console.log(`Member: ${memberId}`)
    console.log(`Changing to: ${newPlan} (₹${newPrice})`)
    
    // Get current member state
    const beforeMember = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true
      }
    })
    
    console.log(`Before: ${beforeMember?.name} - ${beforeMember?.membershipType} (₹${beforeMember?.customPrice})`)
    console.log(`Before lastRenewalAt: ${beforeMember?.lastRenewalAt}`)
    
    // Simulate plan change (like PUT method)
    // Set lastRenewalAt to tomorrow to exclude all current payments
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    
    const updatedMember = await prisma.member.update({
      where: { id: memberId },
      data: {
        membershipType: newPlan,
        customPrice: newPrice,
        lastRenewalAt: tomorrow, // Reset to tomorrow (excludes current payments)
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days for quarterly
      }
    })
    
    console.log(`After: ${updatedMember.name} - ${updatedMember.membershipType} (₹${updatedMember.customPrice})`)
    console.log(`After lastRenewalAt: ${updatedMember.lastRenewalAt}`)
    
    // Test financial calculation after plan change
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials after plan change:`, financials)
    console.log(`=== END PLAN CHANGE SIMULATION ===\n`)
    
    return NextResponse.json({
      success: true,
      before: beforeMember,
      after: updatedMember,
      financials
    })
    
  } catch (error) {
    console.error("[Simulate Plan Change] Error:", error)
    return NextResponse.json({ error: "Failed to simulate plan change" }, { status: 500 })
  }
}
