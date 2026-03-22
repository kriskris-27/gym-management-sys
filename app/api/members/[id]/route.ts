import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { MemberUpdateSchema } from "@/lib/validations"
import { Prisma } from "@prisma/client"

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
          select: { attendance: true },
        },
        attendance: {
          orderBy: { checkedInAt: "desc" },
          take: 1,
          select: { checkedInAt: true },
        },
      },
    })

    // Block deleted members
    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    const { _count, attendance, ...memberData } = member

    let planPrice = 0
    if (member.customPrice !== null && member.customPrice !== undefined) {
      planPrice = member.customPrice
    } else {
      const dbPrice = await prisma.planPricing.findUnique({
        where: { membershipType: member.membershipType }
      })
      planPrice = dbPrice?.amount || 0
    }

    const paymentsAggregate = await prisma.payment.aggregate({
      where: {
        memberId: member.id,
        date: {
          gte: member.startDate,
          lte: member.endDate
        }
      },
      _sum: {
        amount: true
      }
    })

    const totalPaid = paymentsAggregate._sum.amount || 0
    const remaining = planPrice - totalPaid
    const isPaidFull = remaining <= 0

    return NextResponse.json({
      member: {
        ...memberData,
        attendanceCount: _count.attendance,
        lastVisited: attendance[0]?.checkedInAt || null,
        dueAmount: planPrice,
        totalPaid,
        remaining,
        isPaidFull
      },
    })
  } catch (error) {
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
        error: (validated.error as any).issues[0].message 
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

    // 2. Prepare payload
    let finalUpdatePayload: any = { ...updateData }
    delete finalUpdatePayload.id

    // 3. membershipType changed → auto-recalculate endDate
    if (updateData.membershipType && updateData.membershipType !== existingMember.membershipType) {
      if (updateData.membershipType === "PERSONAL_TRAINING") {
        if (!body.endDate) {
          return NextResponse.json(
            { error: "End date is required when switching to Personal Training" }, 
            { status: 400 }
          )
        }
      } else {
        const daysMap = {
          MONTHLY: 30,
          QUARTERLY: 90,
          HALF_YEARLY: 180,
          ANNUAL: 365,
        }
        const daysToAdd = daysMap[updateData.membershipType as keyof typeof daysMap]
        const startDateBasis = updateData.startDate ? new Date(updateData.startDate) : new Date(existingMember.startDate)
        
        const newEndDate = new Date(startDateBasis)
        newEndDate.setDate(startDateBasis.getDate() + daysToAdd)
        finalUpdatePayload.endDate = newEndDate
      }
    }

    // 4. Perform the update
    const updatedMember = await prisma.member.update({
      where: { id },
      data: finalUpdatePayload,
      select: {
        id: true,
        name: true,
        phone: true,
        membershipType: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ member: updatedMember })

  } catch (error) {
    // Catch-all for duplicate phone numbers across different IDs
    if ((error as any).code === "P2002") {
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
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH: Renewal handler for extending membership
 * Logic: Supports renewing with optional membership type change
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

    if (!member || member.status === "DELETED") {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      )
    }

    // CASE 1: Renewal
    // body = { action: "renew", membershipType, startDate, customPrice }
    if (body.action === "renew") {
      const daysMap: Record<string, number> = {
        MONTHLY: 30,
        QUARTERLY: 90,
        HALF_YEARLY: 180,
        ANNUAL: 365,
      }

      const type = body.membershipType ?? member.membershipType
      const start = body.startDate 
        ? new Date(body.startDate) 
        : new Date()

      let end: Date
      if (type === "PERSONAL_TRAINING") {
        if (!body.endDate) {
          return NextResponse.json(
            { error: "End date required for Personal Training" },
            { status: 400 }
          )
        }
        end = new Date(body.endDate)
      } else {
        end = new Date(start)
        end.setDate(start.getDate() + daysMap[type])
      }

      // Get new price if not provided
      let newPrice = body.customPrice
      if (newPrice === undefined || newPrice === null) {
        const planPricing = await prisma.planPricing.findUnique({
          where: { membershipType: type }
        })
        newPrice = planPricing?.amount ?? 0
      }

      const updated = await prisma.member.update({
        where: { id },
        data: {
          membershipType: type,
          startDate: start,
          endDate: end,
          customPrice: newPrice,
          status: "ACTIVE"  // always reactivate on renewal
        }
      })

      return NextResponse.json({ member: updated })
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    )

  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    )
  }
}