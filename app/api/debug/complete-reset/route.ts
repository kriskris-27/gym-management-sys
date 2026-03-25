import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    console.log(`\n=== COMPLETE PAYMENT CYCLE RESET ===`)
    console.log(`Member: ${memberId}`)
    
    // Set lastRenewalAt to a future time that excludes ALL payments
    const futureTime = new Date()
    futureTime.setDate(futureTime.getDate() + 7) // 7 days from now
    futureTime.setHours(23, 59, 59, 999) // End of day
    
    console.log(`Setting lastRenewalAt to future: ${futureTime.toISOString()}`)
    
    // Update member
    const updatedMember = await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: futureTime
      }
    })
    
    console.log(`Updated lastRenewalAt: ${updatedMember.lastRenewalAt}`)
    
    // Test financial calculation
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials after reset:`, financials)
    console.log(`=== END RESET ===\n`)
    
    return NextResponse.json({
      success: true,
      message: "Payment cycle completely reset",
      lastRenewalAt: updatedMember.lastRenewalAt,
      financials
    })
    
  } catch (error) {
    console.error("[Complete Reset] Error:", error)
    return NextResponse.json({ error: "Failed to reset" }, { status: 500 })
  }
}
