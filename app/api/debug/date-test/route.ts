import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get("memberId")
    
    if (!memberId) {
      return NextResponse.json({ error: "Member ID required" }, { status: 400 })
    }

    console.log(`\n=== DATE DEBUG TEST ===`)
    
    // Get member data
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        lastRenewalAt: true,
        startDate: true,
        endDate: true
      }
    })

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // Get all payments
    const payments = await prisma.payment.findMany({
      where: { memberId },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true
      }
    })

    // Manual date comparison test
    const periodStart = member.lastRenewalAt ?? member.startDate
    const periodStartDate = new Date(periodStart.toISOString().split('T')[0])
    
    console.log(`Member: ${member.name}`)
    console.log(`Period start: ${periodStart}`)
    console.log(`Period start date (filtered): ${periodStartDate.toISOString()}`)
    console.log(`Period start date string: ${periodStartDate.toISOString().split('T')[0]}`)
    
    const paymentAnalysis = payments.map(payment => {
      const paymentDate = new Date(payment.date)
      const paymentDateString = paymentDate.toISOString().split('T')[0]
      const periodDateString = periodStartDate.toISOString().split('T')[0]
      
      const isAfter = paymentDateString >= periodDateString
      const isAfterDate = paymentDate >= periodStartDate
      
      return {
        id: payment.id,
        amount: payment.amount,
        originalDate: payment.date,
        paymentDate: paymentDate.toISOString(),
        paymentDateString,
        periodDateString,
        isAfterStringComparison: isAfter,
        isAfterDateComparison: isAfterDate,
        shouldBeIncluded: isAfter && isAfterDate
      }
    })
    
    console.log(`Payment analysis:`, JSON.stringify(paymentAnalysis, null, 2))
    console.log(`=== END DATE DEBUG TEST ===\n`)

    return NextResponse.json({
      member,
      periodStart,
      periodStartDate,
      payments,
      paymentAnalysis
    })

  } catch (error) {
    console.error("[Date Debug] Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
