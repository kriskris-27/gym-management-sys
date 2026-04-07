import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { PaymentCreateSchema } from "@/lib/validations"
import {
  assertGlobalPaymentAllowed,
  assertNoCurrentPlanOverpay,
  computeGlobalMemberLedger,
  getLivePlanPaymentRemaining,
} from "@/domain/payment"

/**
 * GET: Retrieve payments list with optional filtering
 * Logic: Supports searching by Member ID, Date ranges, and Payment Mode.
 */
export async function GET(request: Request) {
  const auth = await requireAuthUser("GET /api/payments")
  if (!auth.ok) return auth.response

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
      where.createdAt = {}
      if (startDate) {
        const parsed = new Date(startDate)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid startDate format" },
            { status: 400 }
          )
        }
        where.createdAt.gte = parsed
      }
      if (endDate) {
        const parsed = new Date(endDate)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "Invalid endDate format" },
            { status: 400 }
          )
        }
        where.createdAt.lte = parsed
      }
    }

    // Validate and apply Payment Mode Filter
    if (mode && ["CASH", "UPI", "CARD"].includes(mode)) {
      where.method = mode as "CASH" | "UPI" | "CARD"
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
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.payment.count({ where })
    ])

    const formattedPayments = payments.map((p: any) => ({
      id: p.id,
      memberId: p.memberId,
      memberName: p.member.name,
      amount: p.finalAmount,
      date: p.createdAt.toISOString(),
      mode: p.method,
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
  const auth = await requireAuthUser("POST /api/payments")
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const validated = PaymentCreateSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ 
        error: validated.error.issues[0].message 
      }, { status: 400 })
    }

    const data = validated.data

    // 1. Verify Member is Valid
    const member = await prisma.member.findUnique({
      where: { id: data.memberId },
      select: { id: true, name: true, status: true }
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const globalLedger = await computeGlobalMemberLedger(data.memberId)
    const globalGuard = assertGlobalPaymentAllowed({
      amount: data.amount,
      globalRemaining: globalLedger.remaining,
    })
    if (!globalGuard.ok) {
      return NextResponse.json(
        { error: globalGuard.message, code: globalGuard.code },
        { status: globalGuard.code === "MEMBER_FULLY_PAID" ? 409 : 400 }
      )
    }

    const liveLedger = await getLivePlanPaymentRemaining(data.memberId)
    const payRounded = Math.round(data.amount)

    let subscriptionId: string | null = null
    let baseAmount = payRounded

    if (
      liveLedger.liveSubscriptionId &&
      liveLedger.remaining > 1 &&
      payRounded <= liveLedger.remaining + 1
    ) {
      const liveGuard = assertNoCurrentPlanOverpay({
        amount: data.amount,
        remaining: liveLedger.remaining,
      })
      if (!liveGuard.ok) {
        return NextResponse.json(
          { error: liveGuard.message, code: liveGuard.code },
          { status: liveGuard.code === "CURRENT_PLAN_FULLY_PAID" ? 409 : 400 }
        )
      }
      subscriptionId = liveLedger.liveSubscriptionId
      baseAmount = liveLedger.planAmount
    } else if (
      liveLedger.liveSubscriptionId &&
      liveLedger.remaining > 1 &&
      payRounded > liveLedger.remaining + 1
    ) {
      // More than this plan's share: record against global ledger only (no sub link)
      subscriptionId = null
      baseAmount = payRounded
    } else {
      subscriptionId = null
      baseAmount = payRounded
    }

    // 2. Insert into Ledger
    const payment = await prisma.payment.create({
      data: {
        memberId: data.memberId,
        subscriptionId,
        baseAmount: baseAmount,                 // Use sub snapshot as base truth
        discountAmount: 0,
        finalAmount: data.amount,               // The actual cash/upi paid
        createdAt: data.date,
        method: (data.mode as any),
        notes: data.notes || "",
        status: "SUCCESS",
        purpose: "SUBSCRIPTION"
      },
      include: {
        member: { select: { name: true } }
      }
    })

    console.log(`[Payment Create] Created payment ${payment.id} for member ${data.memberId}`)

    return NextResponse.json({
      payment: {
        id: payment.id,
        memberId: payment.memberId,
        memberName: member.name,
        amount: payment.finalAmount,
        date: payment.createdAt.toISOString(),
        mode: payment.method,
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
