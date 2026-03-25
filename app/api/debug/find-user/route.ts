import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function GET() {
  try {
    console.log(`\n=== FIND PROOF TEST USER ===`)
    
    // Find the member by phone number
    const member = await prisma.member.findUnique({
      where: { phone: "8888888888" },
      select: {
        id: true,
        name: true,
        phone: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true,
        startDate: true,
        endDate: true
      }
    })
    
    if (!member) {
      return NextResponse.json({ error: "Proof Test User not found" }, { status: 404 })
    }
    
    console.log(`Found: ${member.name} (${member.phone}) - ID: ${member.id}`)
    console.log(`Current plan: ${member.membershipType} - ₹${member.customPrice}`)
    console.log(`Last renewal: ${member.lastRenewalAt}`)
    
    // Get current payments
    const payments = await prisma.payment.findMany({
      where: { memberId: member.id },
      select: {
        id: true,
        amount: true,
        date: true,
        mode: true,
        notes: true
      },
      orderBy: { date: 'desc' }
    })
    
    console.log(`Payments: ${payments.length} payments`)
    payments.forEach(p => {
      console.log(`  - ₹${p.amount} on ${p.date} (${p.mode})`)
    })
    
    // Get current financials
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(member.id)
    
    console.log(`Current financials:`, financials)
    console.log(`=== END FIND USER ===\n`)
    
    return NextResponse.json({
      success: true,
      member,
      payments,
      financials
    })
    
  } catch (error) {
    console.error("[Find User] Error:", error)
    return NextResponse.json({ error: "Failed to find user" }, { status: 500 })
  }
}
