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

    // Create member with new schema (no old fields)
    const member = await prisma.member.create({
      data: {
        name: data.name,
        phone: data.phone,
        phoneNormalized: data.phone.replace(/\D/g, ''), // Remove non-digits for normalized phone
        status: data.status || "ACTIVE",
        // Note: membershipType, startDate, endDate, customPrice are now handled by subscriptions
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

    // TODO: Create subscription if membershipType is provided
    // This would use domain functions in the future
    if (data.membershipType && data.startDate) {
      console.log("📝 TODO: Create subscription for member", member.id)
      // Future: await createSubscriptionWithDate(member.id, planId, customPrice, startDate)
    }

    return NextResponse.json({ member }, { status: 201 })

  } catch (error) {
    console.error("❌ API ERROR [POST /api/members]:", error)

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
