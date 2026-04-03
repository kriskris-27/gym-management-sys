import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { MemberCreateSchema } from "@/lib/validations"

/**
 * GET: List all members with filtering and search
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get("search")
    ?.trim()
    .slice(0, 100)
  const status = searchParams.get("status")

  try {
    const where: any = {}

    // Status filtering (allow ACTIVE/INACTIVE/DELETED)
    if (status && ["ACTIVE", "INACTIVE", "DELETED"].includes(status)) {
      where.status = status as "ACTIVE" | "INACTIVE" | "DELETED"
    } else if (!status) {
      // Default: exclude DELETED members
      where.status = { not: "DELETED" }
    }

    // Search by Name or Phone (case-insensitive)
    if (search) {
      // Prisma handles 'contains' sanitization internally
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ]
    }

    const members = await prisma.member.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        status: true,
        createdAt: true,
        lastCheckinAt: true,
        updatedAt: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            endDate: true,
            status: true,
            planPriceSnapshot: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ members }, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate",
      },
    })

  } catch (error) {
    return NextResponse.json({ error: "Could not retrieve members" }, { status: 500 })
  }
}

/**
 * POST: Create a new member (simplified for new schema)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    const validated = MemberCreateSchema.safeParse(body)
    
    if (!validated.success) {
      return NextResponse.json({ 
        error: validated.error.issues[0].message 
      }, { status: 400 })
    }

    const data = validated.data

    // Use a transaction to ensure Member, Subscription, and Payment are created atomically
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.member.create({
        data: {
          name: data.name,
          phone: data.phone,
          phoneNormalized: data.phone.replace(/\D/g, ''), 
          status: data.status || "ACTIVE",
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          createdAt: true,
          lastCheckinAt: true,
          updatedAt: true,
        },
      })

      if (data.membershipType && data.startDate) {
        // Fetch plan to get duration and base price
        const plan = await tx.plan.findUnique({
          where: { name: data.membershipType }
        })

        if (!plan) {
          throw new Error(`Plan error: '${data.membershipType}' not found in database. Please configure pricing first.`)
        }

        // Calculate end date strictly server-side if it isn't explicitly provided
        let resolvedEndDate = data.endDate;
        if (!resolvedEndDate) {
          resolvedEndDate = new Date(data.startDate);
          resolvedEndDate.setDate(resolvedEndDate.getDate() + plan.durationDays);
        }

        const discount = data.discountAmount || 0;
        const finalPrice = Math.max(0, plan.price - discount);

        // 1. Create Subscription
        const subscription = await tx.subscription.create({
          data: {
            memberId: newMember.id,
            planId: plan.id,
            startDate: data.startDate,
            endDate: resolvedEndDate,
            status: "ACTIVE",
            planNameSnapshot: plan.name,
            planPriceSnapshot: finalPrice,
          }
        })

        // 2. Create Payment Record
        await tx.payment.create({
          data: {
            memberId: newMember.id,
            subscriptionId: subscription.id,
            baseAmount: plan.price,
            discountAmount: discount,
            finalAmount: finalPrice,
            method: "CASH", 
            status: "SUCCESS",
            purpose: "SUBSCRIPTION"
          }
        })

        // 3. Log Audit Event
        await tx.auditLog.create({
          data: {
            entityType: "MEMBER",
            entityId: newMember.id,
            action: "CREATED_WITH_SUBSCRIPTION",
            after: { 
              name: newMember.name, 
              plan: plan.name,
              baseAmount: plan.price,
              discountAmount: discount,
              finalAmount: finalPrice 
            }
          }
        })
      } else {
         // Audit log for plain member
         await tx.auditLog.create({
          data: {
            entityType: "MEMBER",
            entityId: newMember.id,
            action: "CREATED",
            after: { name: newMember.name }
          }
        })
      }

      return newMember
    })

    return NextResponse.json({ member }, { status: 201 })

  } catch (error) {
    console.error("❌ API ERROR [POST /api/members]:", error)

    if (error instanceof Error && error.message.includes("Plan error")) {
       return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Handle specific Prisma duplicate constraint
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "Member with this phone already exists" },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
