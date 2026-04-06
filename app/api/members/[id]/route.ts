import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { MemberUpdateSchema } from "@/lib/validations"
import { syncMemberOperationalStatus } from "@/domain/subscription"
import { deriveMemberPlanState } from "@/domain/member-status"
import {
  cancelMemberPlan,
  MemberLifecycleError,
  renewOrSwitchMemberPlan,
  restoreMember,
} from "@/domain/member-lifecycle"

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
    const [financials, planState] = await Promise.all([
      computeMemberFinancials(id),
      deriveMemberPlanState(id),
    ])
    const displaySub = planState.displaySubscription

    return NextResponse.json({
      member: {
        ...memberData,
        ...financials,
        membershipType: displaySub?.planNameSnapshot || "NONE",
        subscriptionStatus: displaySub?.status || "INACTIVE",
        startDate: displaySub?.startDate || null,
        endDate: displaySub?.endDate || null,
        planUiState: planState.planUiState,
        attendanceCount: _count.sessions,
        lastVisited: sessions[0]?.checkIn || null,
        futurePlansCount: 0,
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
          status: updateData.status === "DELETED" ? "DELETED" : undefined
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
            throw new Error("Cannot change plan price because payments have already been recorded. Cancel and create a new plan if a price adjustment is needed.")
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

      await syncMemberOperationalStatus(id, tx)
      return m
    })


    return NextResponse.json({ member: updatedMember })

  } catch (error) {
    console.error("❌ Member PUT Error:", error)
    if (error instanceof Error && (error.message.includes("not found") || error.message.includes("Cannot change plan price"))) {
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

    // CASE 1: Restore deleted member
    if (body.action === "restore") {
      const { RestoreMemberSchema } = await import("@/lib/validations")
      const validated = RestoreMemberSchema.safeParse(body)
      if (!validated.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
      const restored = await restoreMember(id)
      return NextResponse.json({ member: restored })
    }

    // CASE 2: Renewal / Switch
    if (body.action === "renew" || body.action === "switch") {
      const { RenewMemberSchema } = await import("@/lib/validations")
      const validated = RenewMemberSchema.safeParse(body)
      if (!validated.success) return NextResponse.json({ error: validated.error.issues[0].message }, { status: 400 })
      const res = await renewOrSwitchMemberPlan(id, {
        action: body.action,
        membershipType: validated.data.membershipType,
        endDate: validated.data.endDate,
        customPrice: validated.data.customPrice,
        manualPlanName: validated.data.manualPlanName,
        paidAmount: validated.data.paidAmount,
        paymentMode: validated.data.paymentMode,
      })
      return NextResponse.json(res)
    }


    // CASE 3: Cancel Active Subscription (To allow Plan Switching)
    if (body.action === "cancel") {
      const result = await cancelMemberPlan(id)
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })

  } catch (error) {
    console.error("❌ Member PATCH Error:", error)
    if (error instanceof MemberLifecycleError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 })
  }
}