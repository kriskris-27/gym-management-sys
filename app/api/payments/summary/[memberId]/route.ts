import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

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
      where: { id: memberId }
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
    const paymentsSum = await prisma.payment.aggregate({
      where: {
        memberId: member.id,
        date: {
          gte: member.startDate,
          lte: member.endDate
        }
      },
      _sum: {
        amount: true
      }
    })

    // Step 3: Calculate
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
    })

  } catch (error) {
    console.error("Payment summary error", error)
    return NextResponse.json({ error: "Failed to fetch payment summary" }, { status: 500 })
  }
}

