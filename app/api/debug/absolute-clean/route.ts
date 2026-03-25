import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    // Set lastRenewalAt to a date far in the future to exclude ALL existing payments
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 30) // 30 days from now
    futureDate.setHours(23, 59, 59, 999)
    
    const updated = await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: futureDate
      }
    })
    
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    return NextResponse.json({
      success: true,
      message: "Absolute clean payment cycle - all old payments excluded",
      lastRenewalAt: updated.lastRenewalAt,
      financials
    })
    
  } catch (error) {
    console.error("[Absolute Clean] Error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
