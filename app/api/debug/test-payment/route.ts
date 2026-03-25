import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, amount } = await request.json()
    
    console.log(`\n=== TEST PAYMENT AFTER PLAN CHANGE ===`)
    console.log(`Member: ${memberId}`)
    console.log(`Payment Amount: ₹${amount}`)
    
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
    
    console.log(`Before payment: ${before.name} - ${before.membershipType}`)
    console.log(`Before lastRenewalAt: ${before.lastRenewalAt}`)
    
    // Get current financials
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
        notes: "Test payment after plan change"
      }
    })
    
    console.log(`Created payment: ₹${amount} on ${today}`)
    
    // Apply the payment cycle fix
    const currentMember = await prisma.member.findUnique({
      where: { id: memberId },
      select: { lastRenewalAt: true }
    })
    
    const now = new Date()
    const paymentDate = new Date(today)
    
    if (currentMember?.lastRenewalAt && currentMember.lastRenewalAt > now) {
      console.log(`Detected future lastRenewalAt, updating to payment date`)
      await prisma.member.update({
        where: { id: memberId },
        data: {
          lastRenewalAt: paymentDate
        }
      })
    } else {
      await prisma.member.update({
        where: { id: memberId },
        data: {
          lastRenewalAt: paymentDate
        }
      })
    }
    
    // Check after payment
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
    
    console.log(`After payment: ${after?.name} - ${after?.membershipType}`)
    console.log(`After lastRenewalAt: ${after?.lastRenewalAt}`)
    
    const afterFinancials = await computeMemberFinancials(memberId)
    
    console.log(`After financials:`, afterFinancials)
    console.log(`=== END PAYMENT TEST ===\n`)
    
    return NextResponse.json({
      success: true,
      before: {
        member: before,
        financials: beforeFinancials
      },
      payment: {
        id: payment.id,
        amount: payment.amount,
        date: payment.date
      },
      after: {
        member: after,
        financials: afterFinancials
      },
      paymentCountedCorrectly: afterFinancials.totalPaid === amount
    })
    
  } catch (error) {
    console.error("[Test Payment] Error:", error)
    return NextResponse.json({ error: "Payment test failed" }, { status: 500 })
  }
}
