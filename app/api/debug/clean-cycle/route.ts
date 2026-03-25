import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    // Set lastRenewalAt to tomorrow to exclude ALL existing payments
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    
    const updated = await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: tomorrow
      }
    })
    
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    return NextResponse.json({
      success: true,
      message: "Clean payment cycle started - all old payments excluded",
      lastRenewalAt: updated.lastRenewalAt,
      financials
    })
    
  } catch (error) {
    console.error("[Clean Cycle] Error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
