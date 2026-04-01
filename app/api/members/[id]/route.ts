import { NextResponse } from "next/server"
import prisma from "@/lib/prisma-optimized"
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
      },
    })

    // Block deleted members
    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const { _count, sessions, ...memberData } = member

    // Simplified response without fields that don't exist in schema
    return NextResponse.json({
      member: {
        ...memberData,
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

    // 2. Prepare payload with proper typing
    const finalUpdatePayload: Record<string, unknown> = { ...updateData }
    // Remove id from payload if present
    delete finalUpdatePayload.id
    
    // Status can only be changed via DELETE and PATCH
    delete finalUpdatePayload.status

    // 3. Log any subscription-related fields that were submitted (but not handled here)
    if ('membershipType' in updateData) {
      console.log(`[Member Edit] membershipType update requested but should be handled via subscription service`)
      delete finalUpdatePayload.membershipType
    }
    if ('startDate' in updateData) {
      console.log(`[Member Edit] startDate update requested but should be handled via subscription service`)
      delete finalUpdatePayload.startDate
    }
    if ('endDate' in updateData) {
      console.log(`[Member Edit] endDate update requested but should be handled via subscription service`)
      delete finalUpdatePayload.endDate
    }
    if ('customPrice' in updateData) {
      console.log(`[Member Edit] customPrice update requested but should be handled via subscription service`)
      delete finalUpdatePayload.customPrice
    }

    // 4. Perform the update
    const updatedMember = await prisma.member.update({
      where: { id },
      data: finalUpdatePayload,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        lastCheckinAt: true,
        createdAt: true,
        updatedAt: true,
      },
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