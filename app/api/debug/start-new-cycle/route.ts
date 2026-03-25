import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    console.log(`\n=== START NEW PAYMENT CYCLE ===`)
    
    // Update lastRenewalAt to today to start counting new payments
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const updated = await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: today
      }
    })
    
    console.log(`Updated lastRenewalAt to: ${today.toISOString()}`)
    
    // Test financial calculation
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials after starting new cycle:`, financials)
    console.log(`=== END NEW CYCLE ===\n`)
    
    return NextResponse.json({
      success: true,
      message: "New payment cycle started - payments will now be counted",
      lastRenewalAt: updated.lastRenewalAt,
      financials
    })
    
  } catch (error) {
    console.error("[Start New Cycle] Error:", error)
    return NextResponse.json({ error: "Failed to start new cycle" }, { status: 500 })
  }
}
