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
        membershipType: true,
        startDate: true,
        endDate: true,
        status: true,
        customPrice: true,
        lastRenewalAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    })

    // Fetch all plan prices once
    const planPrices = await prisma.planPricing.findMany()
    const priceMap = Object.fromEntries(
      planPrices.map((p) => [p.membershipType, p.amount])
    )

    const memberIds = members.map((m) => m.id)
    const periodPayments =
      memberIds.length > 0
        ? await prisma.payment.findMany({
            where: { memberId: { in: memberIds } },
            select: { memberId: true, amount: true, date: true, createdAt: true },
          })
        : []

    const enriched = members.map((m) => {
      const totalPaid = periodPayments
        .filter(p => {
          const periodStart = m.lastRenewalAt ?? m.startDate
          
          // Use createdAt for period start comparison (has timestamp precision)
          const afterStart = p.createdAt >= periodStart
          
          // Use date for end bound (ACTIVE only)
          const beforeEnd = m.status === "ACTIVE" 
            ? p.date <= m.endDate 
            : true
            
          return p.memberId === m.id && afterStart && beforeEnd
        })
        .reduce((sum, p) => sum + p.amount, 0)

      const dueAmount = m.customPrice !== null && m.customPrice !== undefined
        ? m.customPrice
        : (priceMap[m.membershipType] ?? 0)
      const remaining = dueAmount - totalPaid
      const isPaidFull = remaining <= 0

      return {
        id: m.id,
        name: m.name,
        phone: m.phone,
        membershipType: m.membershipType,
        startDate: m.startDate,
        endDate: m.endDate,
        status: m.status,
        createdAt: m.createdAt,
        totalPaid,
        dueAmount,
        remaining,
        isPaidFull,
      }
    })

    return NextResponse.json({ members: enriched }, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate",
      },
    })


  } catch (error) {
    return NextResponse.json({ error: "Could not retrieve members" }, { status: 500 })
  }
}

/**
 * POST: Create a new member with auto-calculated duration
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
    const startDate = new Date(data.startDate)
    let endDate: Date

    // Helper function to add days to UTC date
    function addDaysUTC(dateStr: string, days: number): Date {
      const [y, m, d] = dateStr.split("-").map(Number)
      const result = new Date(Date.UTC(y, m - 1, d + days))
      return result
    }

    // Auto-calculate endDate based on membershipType
    if (data.membershipType === "PERSONAL_TRAINING" && data.endDate) {
      endDate = new Date(data.endDate)
    } else {
      const daysMap = {
        MONTHLY: 30,
        QUARTERLY: 90,
        HALF_YEARLY: 180,
        ANNUAL: 365,
        PERSONAL_TRAINING: 365, // Default for personal training if no end date specified
      }
      endDate = addDaysUTC(
        data.startDate.toISOString().split("T")[0],
        daysMap[data.membershipType as "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"]
      )
    }

    // Lock price at creation time — always store on member record
    // If customPrice provided in body → use it
    // Otherwise → fetch from PlanPricing table and store that
    let lockedPrice: number = data.customPrice ?? -1

    if (lockedPrice < 0) {
      const planPricing = await prisma.planPricing.findUnique({
        where: { membershipType: data.membershipType }
      })
      lockedPrice = planPricing?.amount ?? 0
    }

    const member = await prisma.member.create({
      data: {
        ...data,
        customPrice: lockedPrice,
        endDate,
        status: "ACTIVE",
      },
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

    // Log historical/expired records as per instructions
    if (new Date(member.endDate) < new Date()) {
      console.log(`⚠️ Historical record added: Member ${member.id} already expired.`)
    }

    return NextResponse.json({ member }, { status: 201 })

  } catch (error) {
    // Log the full error to the server console for easier debugging
    console.error("❌ API ERROR [POST /api/members]:", error)

    // Handle specific Prisma duplicate constraint
    // Using property check instead of instanceof for better reliability with pnpm symlinks
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "Member with this phone already exists" },
        { status: 409 }
      )
    }

    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }

}
