import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const { memberId, amount } = await request.json()
    
    console.log(`\n=== ADD PAYMENT & RENEW ===`)
    
    // Add payment to clear dues
    // Set payment date to tomorrow to be after lastRenewalAt
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const payment = await prisma.payment.create({
      data: {
        memberId: memberId,
        amount: amount,
        date: tomorrow, // Tomorrow's date (after lastRenewalAt)
        mode: "UPI",
        notes: "Payment to clear dues before renewal"
      }
    })
    
    console.log(`Added payment: ₹${amount} (ID: ${payment.id})`)
    
    // Update lastRenewalAt to match payment date
    await prisma.member.update({
      where: { id: memberId },
      data: {
        lastRenewalAt: new Date()
      }
    })
    
    // Check financial state after payment
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const afterPaymentFinancials = await computeMemberFinancials(memberId)
    
    console.log(`After payment financials:`, afterPaymentFinancials)
    
    // Now try renewal
    if (afterPaymentFinancials.remaining <= 0) {
      console.log(`✅ Dues cleared, proceeding with renewal`)
      
      // Renew to new plan
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
      
      const afterRenewalFinancials = await computeMemberFinancials(memberId)
      
      console.log(`After renewal financials:`, afterRenewalFinancials)
      console.log(`=== END PAYMENT & RENEW ===\n`)
      
      return NextResponse.json({
        success: true,
        payment: { id: payment.id, amount: payment.amount },
        afterPaymentFinancials,
        renewedMember: renewed,
        afterRenewalFinancials
      })
    } else {
      return NextResponse.json({
        success: false,
        error: `Still have outstanding balance of ₹${afterPaymentFinancials.remaining}`,
        afterPaymentFinancials
      })
    }
    
  } catch (error) {
    console.error("[Payment & Renew] Error:", error)
    return NextResponse.json({ error: "Failed to complete payment and renewal" }, { status: 500 })
  }
}
