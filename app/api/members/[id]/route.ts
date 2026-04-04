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

    const { _count, sessions, subscriptions, ...memberData } = member
    const latestSubscription = subscriptions[0] && subscriptions[0].status !== "CANCELLED" 
      ? subscriptions[0] 
      : null

    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const financials = await computeMemberFinancials(id)

    return NextResponse.json({
      member: {
        ...memberData,
        ...financials,
        membershipType: latestSubscription?.planNameSnapshot || "NONE",
        subscriptionStatus: latestSubscription?.status || "INACTIVE",
        startDate: latestSubscription?.startDate || null,
        endDate: latestSubscription?.endDate || null,
        attendanceCount: _count.sessions,
        lastVisited: sessions[0]?.checkIn || null,
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
          // If a payment already exists, the price is IMMUTABLE to preserve history.
          const paymentsCount = await tx.payment.count({
            where: { subscriptionId: latestSub.id, status: 'SUCCESS' }
          })

          const isPriceChanging = finalPrice !== latestSub.planPriceSnapshot
          
          await tx.subscription.update({
            where: { id: latestSub.id },
            data: {
              planId,
              planNameSnapshot: planName,
              // Only update if no payments exist OR it's the same price (no change)
              planPriceSnapshot: (!isPriceChanging || paymentsCount === 0) 
                 ? finalPrice 
                 : latestSub.planPriceSnapshot, 
              startDate: updateData.startDate,
              endDate: updateData.endDate
            }
          })

          if (isPriceChanging && paymentsCount > 0) {
             console.warn(`[API] Member PUT: Blocked price change for sub ${latestSub.id} because payments exist.`)
          }
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

      // 1. CHECK FOR OUTSTANDING BALANCE (Debt Block)
      const { computeMemberFinancials } = await import("@/lib/financial-service")
      const financials = await computeMemberFinancials(id)
      const balance = financials.remaining

      if (balance > 1) { // 1 rupee tolerance for float rounding
        return NextResponse.json({ 
          error: `Cannot renew: Member has an outstanding balance of ₹${balance}. Please clear previous dues first.` 
        }, { status: 403 })
      }

      const { membershipType, startDate, endDate, customPrice, manualPlanName } = validated.data
      
      const res = await prisma.$transaction(async (tx) => {
        // 1. PRODUCTION HARDENING: Auto-close existing ACTIVE subscriptions
        // This prevents "Double-Active" edge cases if buttons are double-clicked
        await tx.subscription.updateMany({
          where: { 
            memberId: id,
            status: "ACTIVE"
          },
          data: { status: "EXPIRED" }
        })

        // 2. Get Plan

        const latestSub = member.subscriptions[0]
        const planName = membershipType || latestSub?.planNameSnapshot || "MONTHLY"
        const planLookup = (membershipType === "OTHERS" || planName === "OTHERS") ? "OTHERS" : planName
        let plan = await tx.plan.findUnique({ where: { name: planLookup } })
        
        // Auto-bootstrap OTHERS if missing to prevent "Plan not found" errors
        if (!plan && planLookup === "OTHERS") {
          plan = await tx.plan.create({
            data: { name: "OTHERS", price: 0, durationDays: 1, isActive: true }
          })
        }

        if (!plan) throw new Error(`Plan error: '${planLookup}' not found. Configuration error.`)

        // 3. Anniversary/Admission Date Logic (The 25-Day Rule)
        const now = new Date()
        const istOffset = 5.5 * 60 * 60 * 1000
        const nowIST = new Date(now.getTime() + istOffset)
        
        // Default to provided startDate or Today
        let resolvedStartDate = startDate ? new Date(startDate) : nowIST

        // Apply 25-day cycle preservation and extension logic
        // ONLY if the latest subscription was valid (not cancelled)
        if (latestSub && latestSub.status !== "CANCELLED" && latestSub.endDate) {
          const expiryDate = new Date(latestSub.endDate)
          const gapMs = nowIST.getTime() - expiryDate.getTime()
          const gapDays = gapMs / (1000 * 60 * 60 * 24)

          // CASE A: Member is renewing EARLY (still active)
          // We start the next subscription exactly where the old one ends.
          if (gapDays <= 0) {
            resolvedStartDate = expiryDate
            console.log(`[Renewal] Extending active subscription. Start: ${expiryDate.toISOString()}`)
          }
          // CASE B: Member is late but within the 25-day grace period
          // We backdate to preserve their anniversary/admission day.
          else if (gapDays <= 25) {
            resolvedStartDate = expiryDate
            console.log(`[Renewal] Backdating late renewal (Gap: ${Math.ceil(gapDays)} days)`)
          }
          // CASE C: Member is over 25 days late
          // They start fresh from 'Today' (which is the default nowIST).
          else {
            console.log(`[Renewal] Fresh start for very late renewal (Gap: ${Math.ceil(gapDays)} days)`)
          }
        }

        let resolvedPlanName = plan.name
        let resolvedBasePrice = customPrice !== undefined ? customPrice : plan.price
        let resolvedEndDate = endDate ? new Date(endDate) : null

        if (membershipType === "OTHERS") {
          resolvedPlanName = manualPlanName || "Others"
        }

        if (!resolvedEndDate) {
          resolvedEndDate = new Date(resolvedStartDate)
          resolvedEndDate.setDate(resolvedEndDate.getDate() + (plan.durationDays || 30))
        }

        // 4. Create Subscription
        const subscription = await tx.subscription.create({
          data: {
            memberId: id,
            planId: plan.id,
            startDate: resolvedStartDate,
            endDate: resolvedEndDate,
            status: "ACTIVE",
            planNameSnapshot: resolvedPlanName,
            planPriceSnapshot: resolvedBasePrice
          }
        })

        // 5. Create Payment (Installment Support)
        await tx.payment.create({
          data: {
            memberId: id,
            subscriptionId: subscription.id,
            baseAmount: resolvedBasePrice,
            discountAmount: 0,
            finalAmount: validated.data.paidAmount ?? 0, // Default to 0 instead of auto-paying full price
            method: (validated.data.paymentMode as any) || "CASH",
            status: "SUCCESS",
            purpose: "SUBSCRIPTION"
          }
        })

        // 5. Update Member Status
        const updatedMember = await tx.member.update({
          where: { id },
          data: { status: "ACTIVE" }
        })

        // 6. Audit Log
        await tx.auditLog.create({
          data: {
            entityType: "MEMBER",
            entityId: id,
            action: "RENEWED",
            after: { 
              plan: resolvedPlanName,
              startDate: resolvedStartDate,
              endDate: resolvedEndDate,
              amount: resolvedBasePrice
            }
          }
        })

        return updatedMember
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