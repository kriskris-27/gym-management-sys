import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, amount } = await request.json()
    
    console.log(`\n=== TEST PAYMENT WITH FIXED LOGIC ===`)
    
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
    
    console.log(`Before: ${before?.name} - lastRenewalAt: ${before?.lastRenewalAt}`)
    
    // Get financials before
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const beforeFinancials = await computeMemberFinancials(memberId)
    
    console.log(`Before financials:`, beforeFinancials)
    
    // Create payment with today's date
    const today = new Date().toISOString().split('T')[0]
    
    const payment = await prisma.payment.create({
      data: {
        memberId: memberId,
        amount: amount,
        date: new Date(today),
        mode: "UPI",
        notes: "Test payment with fixed logic"
      }
    })
    
    console.log(`Created payment: ₹${amount} on ${today}`)
    
    // Apply the FIXED payment logic
    const currentMember = await prisma.member.findUnique({
      where: { id: memberId },
      select: { lastRenewalAt: true }
    })
    
    const now = new Date()
    
    if (currentMember?.lastRenewalAt && currentMember.lastRenewalAt > now) {
      console.log(`Preserving future lastRenewalAt: ${currentMember.lastRenewalAt}`)
      // Don't update lastRenewalAt
    } else {
      console.log(`Updating lastRenewalAt to payment date: ${today}`)
      await prisma.member.update({
        where: { id: memberId },
        data: {
          lastRenewalAt: new Date(today)
        }
      })
    }
    
    // Check after payment
    const afterFinancials = await computeMemberFinancials(memberId)
    
    console.log(`After financials:`, afterFinancials)
    console.log(`=== END TEST ===\n`)
    
    return NextResponse.json({
      success: true,
      before: beforeFinancials,
      payment: { amount, date: today },
      after: afterFinancials,
      oldPaymentsExcluded: afterFinancials.totalPaid === amount
    })
    
  } catch (error) {
    console.error("[Test Fixed Payment] Error:", error)
    return NextResponse.json({ error: "Test failed" }, { status: 500 })
  }
}
