import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, newPlan } = await request.json()
    
    console.log(`\n=== TEST UI PLAN CHANGE ===`)
    console.log(`Member: ${memberId}`)
    console.log(`Changing to: ${newPlan}`)
    
    // Get current state
    const before = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true
      }
    })
    
    if (!before) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    
    console.log(`Before: ${before.name} - ${before.membershipType} (₹${before.customPrice})`)
    
    // Get plan pricing
    const planPricing = await prisma.planPricing.findUnique({
      where: { membershipType: newPlan }
    })
    
    const newPrice = planPricing?.amount || 0
    
    // Simulate the exact UI PUT request
    const putData = {
      membershipType: newPlan,
      name: before.name,
      phone: "8888888888", // Test user phone
      status: "ACTIVE"
    }
    
    console.log(`Sending PUT request with data:`, putData)
    
    // Call the actual PUT API (same as UI)
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/members/${memberId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putData)
    })
    
    const result = await response.json()
    console.log(`PUT Response status: ${response.status}`)
    console.log(`PUT Response:`, result)
    
    // Check the result
    const after = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true
      }
    })
    
    console.log(`After: ${after?.name} - ${after?.membershipType} (₹${after?.customPrice})`)
    console.log(`After lastRenewalAt: ${after?.lastRenewalAt}`)
    
    // Test financial calculation
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials after UI plan change:`, financials)
    console.log(`=== END UI PLAN CHANGE TEST ===\n`)
    
    return NextResponse.json({
      success: response.ok,
      before,
      after,
      financials,
      putResponse: result,
      paymentCycleReset: financials.totalPaid === 0
    })
    
  } catch (error) {
    console.error("[Test UI Plan Change] Error:", error)
    return NextResponse.json({ error: "Test failed" }, { status: 500 })
  }
}
