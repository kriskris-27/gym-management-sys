import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    if (!memberId) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 })
    }

    // Get current member data
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        lastRenewalAt: true,
        startDate: true,
        membershipType: true
      }
    })

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    console.log(`[Fix Payment Cycle] Before fix - Member: ${member.name}, Last renewal: ${member.lastRenewalAt}`)

    // Update lastRenewalAt to tomorrow (excludes all current payments)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0) // Set to start of day
    
    const updated = await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: tomorrow
      }
    })

    console.log(`[Fix Payment Cycle] After fix - Member: ${member.name}, Last renewal: ${updated.lastRenewalAt}`)

    return NextResponse.json({ 
      message: "Payment cycle reset successfully",
      member: {
        id: updated.id,
        name: member.name,
        oldLastRenewalAt: member.lastRenewalAt,
        newLastRenewalAt: updated.lastRenewalAt
      }
    })

  } catch (error) {
    console.error("[Fix Payment Cycle] Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
