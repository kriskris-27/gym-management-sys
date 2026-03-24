import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params

    if (!memberId || typeof memberId !== "string" || memberId.trim() === "") {
      return NextResponse.json({ error: "Invalid member ID" }, { status: 400 })
    }

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        phone: true,
        membershipType: true,
        startDate: true,
        endDate: true,
        status: true,
        customPrice: true,
        lastRenewalAt: true,
        createdAt: true
      }
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // Step 1: Get plan price
    const dbPrice = await prisma.planPricing.findUnique({
      where: { membershipType: member.membershipType }
    })
    
    const planPrice = dbPrice?.amount ?? 0
    const dueAmount = member.customPrice ?? planPrice

    // Step 2: Get total paid for CURRENT membership period only
    // Use lastRenewalAt if it exists (exact renewal moment), otherwise fall back to startDate
    const periodStart = member.lastRenewalAt ?? member.startDate
    
    // Build payment filter based on status
    // Use createdAt for period start comparison (has timestamp precision)
    // Use date for end bound (visual period boundary)
    const paymentWhere: Prisma.PaymentWhereInput = {
      memberId: member.id,
      createdAt: { gte: periodStart }
    }
    
    if (member.status === "ACTIVE") {
      paymentWhere.date = { lte: member.endDate }
    }
    
    const paymentsSum = await prisma.payment.aggregate({
      where: paymentWhere,
      _sum: {
        amount: true
      }
    })
    
    const totalPaid = paymentsSum._sum.amount ?? 0
    const remaining = dueAmount - totalPaid
    const isPaidFull = remaining <= 0

    return NextResponse.json({
      dueAmount,
      totalPaid,
      remaining,
      isPaidFull,
      memberName: member.name,
      plan: member.membershipType,
      // Provide clean strings for frontend presentation (YYYY-MM-DD format commonly used)
      startDate: member.startDate.toISOString().split("T")[0],
      endDate: member.endDate.toISOString().split("T")[0]
    }, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate"
      }
    })

  } catch (error) {
    console.error("Payment summary error", error)
    return NextResponse.json({ error: "Failed to fetch payment summary" }, { status: 500 })
  }
}

