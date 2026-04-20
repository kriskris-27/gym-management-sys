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
  getMemberOutstandingSubscriptionDues,
} from "@/domain/payment"
import { lazyExpireStaleSubscriptionsAndSyncMember } from "@/domain/subscription"

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
          member: { select: { name: true, phone: true } },
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
      memberPhone: p.member.phone ?? "",
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
      select: { id: true, name: true, phone: true, status: true },
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    try {
      await lazyExpireStaleSubscriptionsAndSyncMember(data.memberId)
    } catch (lazyErr) {
      console.error(
        `[POST /api/payments] lazyExpireStaleSubscriptionsAndSyncMember failed for ${data.memberId}`,
        lazyErr
      )
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

    const outstanding = await getMemberOutstandingSubscriptionDues(data.memberId)
    if (outstanding.length === 0) {
      return NextResponse.json(
        {
          error:
            "No pending subscription dues found. This member is fully paid for existing subscriptions.",
          code: "NO_PENDING_SUBSCRIPTION_DUE",
        },
        { status: 409 }
      )
    }
    // Deterministic policy: apply front-desk collection to oldest unpaid due first.
    const targetDue = outstanding[outstanding.length - 1]
    const targetGuard = assertNoCurrentPlanOverpay({
      amount: data.amount,
      remaining: targetDue.remaining,
    })
    if (!targetGuard.ok) {
      return NextResponse.json(
        { error: targetGuard.message, code: targetGuard.code },
        { status: targetGuard.code === "CURRENT_PLAN_FULLY_PAID" ? 409 : 400 }
      )
    }

    const subscriptionId: string = targetDue.subscriptionId
    const baseAmount = targetDue.planAmount

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
        member: { select: { name: true, phone: true } },
      },
    })

    console.log(`[Payment Create] Created payment ${payment.id} for member ${data.memberId}`)

    return NextResponse.json({
      payment: {
        id: payment.id,
        memberId: payment.memberId,
        memberName: member.name,
        memberPhone: member.phone ?? "",
        amount: payment.finalAmount,
        date: payment.createdAt.toISOString(),
        mode: payment.method,
        notes: payment.notes,
      },
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
