import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { computeMemberFinancials } from "@/lib/financial-service"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    console.log(`[Payment Summary API] Request for member: ${memberId}`)

    if (!memberId || typeof memberId !== "string" || memberId.trim() === "") {
      console.log(`[Payment Summary API] Invalid member ID: ${memberId}`)
      return NextResponse.json({ error: "Invalid member ID" }, { status: 400 })
    }

    // Get member info for response
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        phone: true,
        membershipType: true,
        startDate: true,
        endDate: true,
        status: true,
        lastRenewalAt: true
      }
    })

    if (!member || member.status === "DELETED") {
      console.log(`[Payment Summary API] Member not found or deleted: ${memberId}`)
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    console.log(`[Payment Summary API] Found member: ${member.name}, calling financial service`)

    // Use centralized financial computation - SINGLE SOURCE OF TRUTH
    const financials = await computeMemberFinancials(memberId)

    console.log(`[Payment Summary API] Financials computed:`, financials)

    const response = {
      ...financials,
      memberName: member.name,
      plan: member.membershipType,
      // Provide clean strings for frontend presentation (YYYY-MM-DD format commonly used)
      startDate: member.startDate.toISOString().split("T")[0],
      endDate: member.endDate?.toISOString().split("T")[0]
    }

    console.log(`[Payment Summary API] Response:`, response)

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    })

  } catch (error) {
    console.error("[Payment Summary API] Error:", error)
    return NextResponse.json({ 
      error: "Failed to fetch payment summary",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}

