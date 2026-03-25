import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"
import { computeMemberFinancials } from "@/lib/financial-service"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get("memberId")
    
    if (!memberId) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 })
    }

    console.log(`\n=== UI TEST DEBUG ===`)
    console.log(`Testing member: ${memberId}`)
    
    // Get member data
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        startDate: true,
        endDate: true,
        lastRenewalAt: true,
        customPrice: true,
        createdAt: true
      }
    })

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    console.log(`Member data:`, member)

    // Get all payments for this member
    const allPayments = await prisma.payment.findMany({
      where: { memberId },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        mode: true
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`All payments:`, allPayments)

    // Get financial calculation
    const financials = await computeMemberFinancials(memberId)
    
    console.log(`Financials result:`, financials)
    console.log(`=== END UI TEST DEBUG ===\n`)

    return NextResponse.json({
      member,
      allPayments,
      financials,
      testTimestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error("[UI Test] Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
