import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Create test member
    const member = await prisma.member.create({
      data: {
        name: "Test User",
        phone: "9999999999",
        membershipType: "MONTHLY",
        startDate: new Date("2026-03-25"),
        endDate: new Date("2026-04-24"),
        customPrice: 1000,
        status: "ACTIVE"
      }
    })

    // Create initial payment (old plan payment)
    const payment = await prisma.payment.create({
      data: {
        memberId: member.id,
        amount: 500,
        date: new Date("2026-03-25"),
        mode: "UPI",
        notes: "Initial payment for old plan"
      }
    })

    console.log(`[Test Setup] Created test member: ${member.id}`)
    console.log(`[Test Setup] Created initial payment: ${payment.id}`)

    return NextResponse.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        membershipType: member.membershipType,
        customPrice: member.customPrice,
        startDate: member.startDate,
        endDate: member.endDate,
        lastRenewalAt: member.lastRenewalAt
      },
      payment: {
        id: payment.id,
        amount: payment.amount,
        date: payment.date
      }
    })

  } catch (error) {
    console.error("[Test Setup] Error:", error)
    return NextResponse.json({ error: "Failed to create test user" }, { status: 500 })
  }
}
