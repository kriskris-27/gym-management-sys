import { NextResponse } from "next/server"
import prisma from "@/lib/prisma-optimized"
import { PaymentCreateSchema } from "@/lib/validations"

/**
 * GET: Retrieve payments list with optional filtering
 * Logic: Supports searching by Member ID, Date ranges, and Payment Mode.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const memberId = searchParams.get("memberId")
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const mode = searchParams.get("mode")

  try {
    const where: any = {}

    // Link by specific member
    if (memberId) where.memberId = memberId
    
    // Flexible Date Ranges (supports partial windows)
    if (startDate || endDate) {
      where.date = {}
      if (startDate) {
        const parsed = new Date(startDate)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid startDate format" },
            { status: 400 }
          )
        }
        where.date.gte = parsed
      }
      if (endDate) {
        const parsed = new Date(endDate)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid endDate format" },
            { status: 400 }
          )
        }
        where.date.lte = parsed
      }
    }

    // Validate and apply Payment Mode Filter
    if (mode && ["CASH", "UPI", "CARD"].includes(mode)) {
      where.mode = mode as "CASH" | "UPI" | "CARD"
    }

    // Pagination
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")))
    const skip = (page - 1) * limit

    // Run query and head count concurrently
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          member: { select: { name: true } }
        },
        orderBy: { date: "desc" },
        skip,
        take: limit
      }),
      prisma.payment.count({ where })
    ])

    const formattedPayments = payments.map((p: any) => ({
      id: p.id,
      memberId: p.memberId,
      memberName: p.member.name,
      amount: p.amount,
      date: p.date.toISOString(), // Raw full UTC format
      mode: p.mode,
      notes: p.notes
    }))

    return NextResponse.json({
      payments: formattedPayments,
      total,
      page,
      limit
    }, {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate"
      }
    })

  } catch (error) {
    console.error("❌ Payment Fetch Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

/**
 * POST: Record a new payment from a member
 * Logic: Validated with Zod schema and enforces member existence (non-deleted).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = PaymentCreateSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ 
        error: validated.error.issues[0].message 
      }, { status: 400 })
    }

    const data = validated.data

    // 1. Verify Member is Valid (Exists and not deleted)
    const member = await prisma.member.findUnique({
      where: { id: data.memberId }
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // 2. Insert into Ledger
    const payment = await prisma.payment.create({
      data: {
        memberId: data.memberId,
        amount: data.amount,
        date: data.date,
        mode: data.mode,
        notes: data.notes,
      },
      include: {
        member: { select: { name: true } }
      }
    })

    // 3. Handle payment cycle properly
    // Check if current lastRenewalAt is in the future (indicating a reset payment cycle)
    const currentMember = await prisma.member.findUnique({
      where: { id: data.memberId },
      select: { lastRenewalAt: true }
    })
    
    const now = new Date()
    const paymentDate = new Date(data.date)
    
    // Only update lastRenewalAt if it's not set to a future date
    // This preserves the payment cycle reset
    if (currentMember?.lastRenewalAt && currentMember.lastRenewalAt > now) {
      console.log(`[Payment Create] Preserving future lastRenewalAt (${currentMember.lastRenewalAt}) - payment cycle reset in effect`)
      // Don't update lastRenewalAt - keep the future date to exclude old payments
    } else {
      // Normal case: update lastRenewalAt to payment date
      await prisma.member.update({
        where: { id: data.memberId },
        data: {
          lastRenewalAt: paymentDate
        }
      })
      console.log(`[Payment Create] Updated lastRenewalAt to payment date: ${data.date}`)
    }

    console.log(`[Payment Create] Created payment ${payment.id} for member ${data.memberId}, updated lastRenewalAt to ${data.date}`)

    return NextResponse.json({
      payment: {
        id: payment.id,
        memberId: payment.memberId,
        memberName: member.name, // Use the member from the initial query
        amount: payment.amount,
        date: payment.date.toISOString(),
        mode: payment.mode,
        notes: payment.notes
      }
    }, { status: 201 })

  } catch (error) {
    // Catch specifically for non-existent member IDs
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Member not found" }, { status: 404 })
      }
    }
    
    console.error("❌ Payment Creation Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
