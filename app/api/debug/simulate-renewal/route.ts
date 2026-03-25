import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    console.log(`\n=== SIMULATE RENEWAL ATTEMPT ===`)
    
    // Get current member state
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true,
        startDate: true,
        endDate: true
      }
    })
    
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    
    console.log(`Member: ${member.name} - ${member.membershipType} (₹${member.customPrice})`)
    
    // Calculate current remaining amount (like renewal validation)
    const periodStart = member.lastRenewalAt ?? member.startDate
    const paymentWhere = {
      memberId: member.id,
      date: {
        gte: new Date(periodStart.toISOString().split('T')[0]),
        lte: member.endDate ? new Date(member.endDate.toISOString().split('T')[0]) : undefined
      }
    }
    
    const paymentsSum = await prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true }
    })
    
    const totalPaid = paymentsSum._sum.amount ?? 0
    const remaining = (member.customPrice || 0) - totalPaid
    
    console.log(`Payment check: Plan=${member.customPrice}, Paid=${totalPaid}, Remaining=${remaining}`)
    
    if (remaining > 0) {
      console.log(`❌ Renewal BLOCKED: Outstanding balance of ₹${remaining}`)
      return NextResponse.json({
        success: false,
        error: `Cannot renew member. Outstanding balance of ₹${remaining.toLocaleString('en-IN')} must be paid first.`,
        outstandingBalance: remaining,
        renewalAllowed: false
      })
    }
    
    console.log(`✅ Renewal ALLOWED: All dues cleared`)
    
    // If renewal was allowed, simulate it
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    
    const renewed = await prisma.member.update({
      where: { id: memberId },
      data: {
        membershipType: "MONTHLY",
        customPrice: 3000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastRenewalAt: tomorrow,
        status: "ACTIVE"
      }
    })
    
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`After renewal: ${renewed.name} - ${renewed.membershipType} (₹${renewed.customPrice})`)
    console.log(`Financials after renewal:`, financials)
    console.log(`=== END RENEWAL SIMULATION ===\n`)
    
    return NextResponse.json({
      success: true,
      renewalAllowed: true,
      before: member,
      after: renewed,
      financials
    })
    
  } catch (error) {
    console.error("[Simulate Renewal] Error:", error)
    return NextResponse.json({ error: "Failed to simulate renewal" }, { status: 500 })
  }
}
