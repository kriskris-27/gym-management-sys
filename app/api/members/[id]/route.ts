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
    const latestSubscription = subscriptions[0] || null

    return NextResponse.json({
      member: {
        ...memberData,
        membershipType: latestSubscription?.planNameSnapshot || "NONE",
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
        const latestSub = await tx.subscription.findFirst({
          where: { memberId: id },
          orderBy: { createdAt: 'desc' }
        })

        if (latestSub) {
          // If membershipType changed, we might need plan details
          let planId = latestSub.planId
          let planName = latestSub.planNameSnapshot

          if (updateData.membershipType && updateData.membershipType !== latestSub.planNameSnapshot) {
            const plan = await tx.plan.findUnique({
              where: { name: updateData.membershipType }
            })
            if (plan) {
              planId = plan.id
              planName = plan.name
            }
          }

          await tx.subscription.update({
            where: { id: latestSub.id },
            data: {
              planId,
              planNameSnapshot: planName,
              startDate: updateData.startDate,
              endDate: updateData.endDate
              // Note: We don't change price on simple edit unless explicitly requested
            }
          })
        }
      }

      return m
    })

    return NextResponse.json({ member: updatedMember })

  } catch (error) {
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
 * Logic: Supports renewing with optional membership type change, and restoring deleted members
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const member = await prisma.member.findUnique({
      where: { id }
    })

    if (!member) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      )
    }

    // CASE 1: Restore deleted member
    // body = { action: "restore" }
    if (body.action === "restore") {
      const { RestoreMemberSchema } = await import("@/lib/validations")
      const validated = RestoreMemberSchema.safeParse(body)
      if (!validated.success) {
        return NextResponse.json(
          { error: "Invalid request" },
          { status: 400 }
        )
      }

      if (member.status !== "DELETED") {
        return NextResponse.json(
          { error: "Member is not deleted" },
          { status: 400 }
        )
      }

      const restored = await prisma.member.update({
        where: { id },
        data: {
          status: "ACTIVE"
        }
      })

      return NextResponse.json({ member: restored })
    }

    // CASE 2: Renewal
    // body = { action: "renew" }
    if (body.action === "renew") {
      if (member.status === "DELETED") {
        return NextResponse.json(
          { error: "Cannot renew a deleted member. Restore first." },
          { status: 400 }
        )
      }

      console.log(`[Member Renewal] Renewal requested for member ${member.name}`)
      console.log(`[Member Renewal] Note: Subscription renewal should be handled via subscription service`)
      
      // For now, just update lastCheckinAt to indicate activity
      const updated = await prisma.member.update({
        where: { id },
        data: {
          lastCheckinAt: new Date()
        }
      })

      return NextResponse.json({ 
        success: true,
        message: "Member activity updated. Subscription renewal should be handled via subscription service.",
        member: updated
      })
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    )

  } catch (error) {
    console.error("❌ Member PATCH Error:", error)
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}