import { NextResponse } from "next/server"
import { getMemberStatusSnapshot } from "@/domain/member-status"

/**
 * GET: Get member status including subscription and payment information
 * Used by UI to show member status, subscription details, and payment status
 * Note: Authentication bypassed for development testing
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const response = await getMemberStatusSnapshot(id)
    return NextResponse.json(response)

  } catch (error) {
    console.error("❌ Member Status Error:", error)
    return NextResponse.json({ error: "Internal Error" }, { status: 500 })
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "GET" } }
  )
}
