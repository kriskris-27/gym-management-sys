import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { MemberUpdateSchema } from "@/lib/validations"

/**
 * GET: Retrieve single member with attendance stats
 * Guards: Excludes DELETED members
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const member = await prisma.member.findUnique({
      where: { id },
      include: {
        _count: {
          select: { sessions: true },
        },
        sessions: {
          orderBy: { checkIn: "desc" },
          take: 1,
          select: { checkIn: true },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        }
      },
    })

    // Block deleted members
    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const { _count, sessions, ...memberData } = member
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(id)

    // IMPROVED LOGIC: Find the subscription that is active TODAY
    const allSubs = await prisma.subscription.findMany({
      where: { memberId: id, status: { not: "CANCELLED" } },
      orderBy: { endDate: 'desc' }
    })

    const now = new Date()
    const activeSub = allSubs.find(s => s.startDate <= now && s.endDate >= now) || allSubs[0]
    
    // Future plans are those that haven't started yet and aren't the one we are displaying
    const futureSubs = allSubs.filter(s => s.startDate > now && s.id !== activeSub?.id).length

    return NextResponse.json({
      member: {
        ...memberData,
        ...financials,
        membershipType: activeSub?.planNameSnapshot || "NONE",
        subscriptionStatus: activeSub?.status || "INACTIVE",
        startDate: activeSub?.startDate || null,
        endDate: activeSub?.endDate || null,
        attendanceCount: _count.sessions,
        lastVisited: sessions[0]?.checkIn || null,
        futurePlansCount: futureSubs
      },
    })
  } catch (error) {
    console.error("❌ Member GET Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

/**
 * PUT: Partial update of member details
 * Logic: Recalculates endDate if membershipType changes
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    
    // Validate with Zod
    const validated = MemberUpdateSchema.safeParse({ ...body, id })
    if (!validated.success) {
      return NextResponse.json({ 
        error: validated.error.issues[0].message 
      }, { status: 400 })
    }

    const updateData = validated.data

    // 1. Core lookup (Ensures member exists and isn't deleted)
    const existingMember = await prisma.member.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    if (!existingMember || existingMember.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // 2. Perform update in a transaction to handle member and subscription
    const updatedMember = await prisma.$transaction(async (tx) => {
      // A. Update core member data
      const m = await tx.member.update({
        where: { id },
        data: {
          name: updateData.name,
          phone: updateData.phone,
          phoneNormalized: updateData.phone ? updateData.phone.replace(/\D/g, '') : undefined,
          status: updateData.status
        },
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          lastCheckinAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      // B. Update subscription if relevant fields are provided
      if (updateData.membershipType || updateData.startDate || updateData.endDate) {
        const latestSub = existingMember.subscriptions[0]

        if (latestSub) {
          // If membershipType changed, we might need plan details
          let planId = latestSub.planId
          let planName = latestSub.planNameSnapshot
          let finalPrice = latestSub.planPriceSnapshot

          if (updateData.membershipType && updateData.membershipType !== latestSub.planNameSnapshot) {
            if (updateData.membershipType === "OTHERS") {
              let othersPlan = await tx.plan.findUnique({ where: { name: "OTHERS" } })
              if (!othersPlan) {
                othersPlan = await tx.plan.create({
                  data: { name: "OTHERS", price: 0, durationDays: 1, isActive: true }
                })
              }
              planId = othersPlan.id
              planName = updateData.manualPlanName || "Others"
              finalPrice = updateData.manualAmount || latestSub.planPriceSnapshot || 0
            } else {
              const plan = await tx.plan.findUnique({
                where: { name: updateData.membershipType }
              })
              if (plan) {
                planId = plan.id
                planName = plan.name
                finalPrice = plan.price
              }
            }
          } else if (updateData.membershipType === "OTHERS") {
            // Updating existing OTHERS plan details
            if (updateData.manualPlanName) planName = updateData.manualPlanName
            if (updateData.manualAmount !== undefined) finalPrice = updateData.manualAmount
          }

          // CHECK: Can we update the snapshot price? 
          const paymentsCount = await tx.payment.count({
            where: { subscriptionId: latestSub.id, status: 'SUCCESS' }
          })
          
          const isPriceChanging = finalPrice !== latestSub.planPriceSnapshot
          
          if (isPriceChanging && paymentsCount > 0) {
            return NextResponse.json({ 
              error: "Cannot change plan price because payments have already been recorded. Cancel and create a new plan if a price adjustment is needed."
            }, { status: 400 })
          }

          await tx.subscription.update({
            where: { id: latestSub.id },
            data: {
              planId,
              planNameSnapshot: planName,
              planPriceSnapshot: finalPrice, 
              startDate: updateData.startDate,
              endDate: updateData.endDate
            }
          })
        }
      }

      return m
    })


    return NextResponse.json({ member: updatedMember })

  } catch (error) {
    console.error("❌ Member PUT Error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    // Catch-all for duplicate phone numbers across different IDs
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "Member with this phone already exists" }, 
        { status: 409 }
      )
    }

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
/**
 * DELETE: Soft delete a member (mark as DELETED)
 * Logic: Sets status to DELETED instead of hard delete
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const member = await prisma.member.findUnique({
      where: { id }
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      )
    }

    await prisma.member.update({
      where: { id },
      data: { status: "DELETED" }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("❌ Member DELETE Error:", error)
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH: Handler for renewal and restore actions
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const member = await prisma.member.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    })

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // CASE 1: Restore deleted member
    if (body.action === "restore") {
      const { RestoreMemberSchema } = await import("@/lib/validations")
      const validated = RestoreMemberSchema.safeParse(body)
      if (!validated.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

      if (member.status !== "DELETED") return NextResponse.json({ error: "Member not is not deleted" }, { status: 400 })

      const restored = await prisma.member.update({
        where: { id },
        data: { status: "ACTIVE" }
      })
      return NextResponse.json({ member: restored })
    }

    // CASE 2: Renewal
    if (body.action === "renew") {
      const { RenewMemberSchema } = await import("@/lib/validations")
      const validated = RenewMemberSchema.safeParse(body)
      if (!validated.success) return NextResponse.json({ error: validated.error.issues[0].message }, { status: 400 })

      const { computeMemberFinancials } = await import("@/lib/financial-service")
      const financials = await computeMemberFinancials(id)
      if (financials.remaining > 1) {
        return NextResponse.json({ 
          error: `Cannot renew: Member has an outstanding balance of ₹${financials.remaining}. Please clear previous dues first.` 
        }, { status: 403 })
      }

      const { membershipType, startDate, endDate, customPrice, manualPlanName, paidAmount, paymentMode } = validated.data
      const { fromDate, nowUTC } = await import("@/lib/utils")
      
      const res = await prisma.$transaction(async (tx) => {
        const nowIST = nowUTC()
        let resolvedStartDate = startDate ? fromDate(new Date(startDate)) : nowIST

        // 1. Calculate Stacking
        const furthestSub = await tx.subscription.findFirst({
          where: { memberId: id, status: { not: "CANCELLED" } },
          orderBy: { endDate: "desc" }
        })

        if (furthestSub && furthestSub.endDate) {
          const expiryDate = fromDate(furthestSub.endDate)
          const gapDays = nowIST.diff(expiryDate, 'days').days

          if (gapDays <= 0 || gapDays <= 25) {
            resolvedStartDate = expiryDate
          }
        }

        // 2. PRODUCTION GUARD: Auto-close existing ACTIVE if switching NOW
        const isImmediate = resolvedStartDate <= nowIST.plus({ minutes: 5 })
        if (isImmediate) {
          await tx.subscription.updateMany({
            where: { memberId: id, status: "ACTIVE" },
            data: { status: "EXPIRED" }
          })
        }

        // 3. Plan Lookup
        const latestSub = member.subscriptions[0]
        const planName = membershipType || latestSub?.planNameSnapshot || "MONTHLY"
        const planLookup = (membershipType === "OTHERS" || planName === "OTHERS") ? "OTHERS" : planName
        let plan = await tx.plan.findUnique({ where: { name: planLookup } })
        
        if (!plan && planLookup === "OTHERS") {
          plan = await tx.plan.create({
            data: { name: "OTHERS", price: 0, durationDays: 1, isActive: true }
          })
        }
        if (!plan) throw new Error(`Plan '${planLookup}' not found.`)

        // 4. Calculate Dates & Prices
        let resolvedPlanName = (membershipType === "OTHERS") ? (manualPlanName || "Others") : plan.name
        let resolvedBasePrice = customPrice !== undefined ? customPrice : plan.price
        let resolvedEndDate = endDate ? fromDate(new Date(endDate)) : resolvedStartDate.plus({ days: plan.durationDays })

        // 5. Create Records
        const subscription = await tx.subscription.create({
          data: {
            memberId: id,
            planId: plan.id,
            startDate: resolvedStartDate.toJSDate(),
            endDate: resolvedEndDate.toJSDate(),
            status: "ACTIVE",
            planNameSnapshot: resolvedPlanName,
            planPriceSnapshot: resolvedBasePrice
          }
        })

        await tx.payment.create({
          data: {
            memberId: id,
            subscriptionId: subscription.id,
            baseAmount: resolvedBasePrice,
            discountAmount: 0,
            finalAmount: paidAmount ?? 0,
            method: (paymentMode as any) || "CASH",
            status: "SUCCESS",
            purpose: "SUBSCRIPTION"
          }
        })


        await tx.member.update({
          where: { id },
          data: { status: "ACTIVE" }
        })

        await tx.auditLog.create({
          data: {
            entityType: "MEMBER",
            entityId: id,
            action: "RENEWED",
            after: { plan: resolvedPlanName, startDate: resolvedStartDate.toISO(), amount: resolvedBasePrice }
          }
        })

        return subscription
      })

      return NextResponse.json({ success: true, member: res })
    }


    // CASE 3: Cancel Active Subscription (To allow Plan Switching)
    if (body.action === "cancel") {
      const activeSub = member.subscriptions[0]
      if (!activeSub || activeSub.status !== "ACTIVE") {
        return NextResponse.json({ error: "No active subscription to cancel" }, { status: 400 })
      }

      const cancelled = await prisma.subscription.update({
        where: { id: activeSub.id },
        data: { status: "CANCELLED" }
      })

      // Update Member Status to INACTIVE (Triggers Renewal Banner)
      await prisma.member.update({
        where: { id },
        data: { status: "INACTIVE" }
      })

      // Audit Log
      await prisma.auditLog.create({
        data: {
          entityType: "MEMBER",
          entityId: id,
          action: "CANCELLED",
          before: { plan: activeSub.planNameSnapshot, id: activeSub.id }
        }
      })

      return NextResponse.json({ success: true, message: "Subscription cancelled successfully" })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })

  } catch (error) {
    console.error("❌ Member PATCH Error:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 })
  }
}