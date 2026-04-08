import { NextResponse } from "next/server"
import { DateTime } from "luxon"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { PaymentCreateSchema } from "@/lib/validations"
import { GYM_TIMEZONE } from "@/lib/gym-datetime"
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
    const where: Prisma.PaymentWhereInput = {}

    // Link by specific member
    if (memberId) where.memberId = memberId
    
    // Flexible Date Ranges (supports partial windows)
    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) {
        const parsed = DateTime.fromISO(startDate, { zone: GYM_TIMEZONE }).startOf("day")
        const parsedJs = parsed.toUTC().toJSDate()
        if (isNaN(parsedJs.getTime())) {
          return NextResponse.json(
            { error: "Invalid startDate format" },
            { status: 400 }
          )
        }
        where.createdAt.gte = parsedJs
      }
      if (endDate) {
        const parsed = DateTime.fromISO(endDate, { zone: GYM_TIMEZONE }).endOf("day")
        const parsedJs = parsed.toUTC().toJSDate()
        if (isNaN(parsedJs.getTime())) {
          return NextResponse.json(
            { error: "Invalid endDate format" },
            { status: 400 }
          )
        }
        where.createdAt.lte = parsedJs
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
          member: { select: { name: true } },
          subscription: {
            select: {
              id: true,
              planNameSnapshot: true,
              startDate: true,
              endDate: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.payment.count({ where })
    ])

    const formattedPayments = payments.map((p) => ({
      id: p.id,
      memberId: p.memberId,
      memberName: p.member.name,
      subscriptionId: p.subscriptionId ?? null,
      subscription: p.subscription
        ? {
            id: p.subscription.id,
            planNameSnapshot: p.subscription.planNameSnapshot,
            startDate: p.subscription.startDate.toISOString(),
            endDate: p.subscription.endDate.toISOString(),
            status: p.subscription.status,
          }
        : null,
      amount: p.finalAmount,
      discountAmount: p.discountAmount || 0,
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
        "Cache-Control": "private, no-store, max-age=0"
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
      // No live plan (expired / no check-in window). If the latest non-cancelled plan
      // still has dues, auto-attach this payment to that plan so plan-wise history stays correct.
      const latestSub = await prisma.subscription.findFirst({
        where: { memberId: data.memberId, status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, planPriceSnapshot: true },
      })

      if (latestSub) {
        const s = await prisma.payment.aggregate({
          where: { memberId: data.memberId, subscriptionId: latestSub.id, status: "SUCCESS" },
          _sum: { finalAmount: true, discountAmount: true },
        })
        const paid = Math.round((s._sum.finalAmount || 0) + (s._sum.discountAmount || 0))
        const planAmount = Math.round(latestSub.planPriceSnapshot || 0)
        const remaining = Math.max(0, planAmount - paid)

        if (remaining > 1 && payRounded <= remaining + 1) {
          const planGuard = assertNoCurrentPlanOverpay({
            amount: data.amount,
            remaining,
          })
          if (!planGuard.ok) {
            return NextResponse.json(
              { error: planGuard.message, code: planGuard.code },
              { status: planGuard.code === "CURRENT_PLAN_FULLY_PAID" ? 409 : 400 }
            )
          }
          subscriptionId = latestSub.id
          baseAmount = planAmount
        } else {
          subscriptionId = null
          baseAmount = payRounded
        }
      } else {
        subscriptionId = null
        baseAmount = payRounded
      }
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
        method: data.mode,
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
