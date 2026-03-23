import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { formatDuration } from "@/lib/utils"

/**
 * GET: Returns full attendance history for one member
 * Logic: Paginated, sorted by most recent first
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params
    const { searchParams } = new URL(request.url)

    // Validate memberId
    if (!memberId || memberId.trim() === "") {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 }
      )
    }

    // Standard pagination setup
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "20"))
    )
    const skip = (page - 1) * limit

    // 1. Verify Member Exists & Not Deleted
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: { name: true, status: true },
    })

    if (!member || member.status === "DELETED") {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // 2. Head Count (Total Records for Pagination)
    const totalSessions = await prisma.attendance.count({
      where: { memberId },
    })

    // 3. Paginated Data Fetch
    const records = await prisma.attendance.findMany({
      where: { memberId },
      orderBy: { date: "desc" }, 
      skip,
      take: limit,
      select: {
        date: true,
        checkedInAt: true,
        checkedOutAt: true,
        durationMinutes: true,
        autoClosed: true,
      },
    })

    // Formatted result
    return NextResponse.json({
      memberId,
      memberName: member.name,
      totalSessions,
      page,
      limit,
      records: records.map((r) => ({
        date: (() => {
          const istOffset = 5.5 * 60 * 60 * 1000
          const istDate = new Date(
            r.date.getTime() + istOffset
          )
          return istDate.toISOString().split("T")[0]
        })(),
        checkedInAt: r.checkedInAt.toISOString(),
        checkedOutAt: r.checkedOutAt?.toISOString() || null,
        durationMinutes: r.durationMinutes,
        durationFormatted: r.durationMinutes 
          ? formatDuration(r.durationMinutes) 
          : (r.checkedOutAt ? "0min" : "ongoing"),
        autoClosed: r.autoClosed,
      })),
    })

  } catch (error) {
    console.error("❌ Member History Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
