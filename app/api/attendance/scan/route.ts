import { NextResponse } from "next/server"
import { scanMember } from "@/domain/attendance"
import { AttendanceScanSchema } from "../../../../lib/validations"

const rateLimitMap = new Map<string, { count: number; start: number }>()

// Clean stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 60000
  rateLimitMap.forEach((data, ip) => {
    if (data.start < cutoff) rateLimitMap.delete(ip)
  })
}, 5 * 60 * 1000)

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "127.0.0.1"
  const now = new Date()
  const nowMs = now.getTime()

  // 1. RATE LIMITING (keep existing logic)
  const rateLimit = rateLimitMap.get(ip)
  if (rateLimit) {
    if (nowMs - rateLimit.start < 60000) {
      if (rateLimit.count >= 10) {
        return NextResponse.json(
          { error: "Too many attempts", code: "RATE_LIMITED" },
          { status: 429 }
        )
      }
      rateLimit.count++
    } else {
      rateLimitMap.set(ip, { count: 1, start: nowMs })
    }
  } else {
    rateLimitMap.set(ip, { count: 1, start: nowMs })
  }

  try {
    const body = await request.json()
    const validated = AttendanceScanSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid phone", code: "VALIDATION" },
        { status: 400 }
      )
    }

    const { phone } = validated.data

    // 2. DELEGATE TO DOMAIN FUNCTION (NEW)
    const result = await scanMember(phone)

    // 3. FORMAT RESPONSE FOR API COMPATIBILITY
    const response = {
      status: result.state,
      message: result.message,
      memberName: result.memberName,
      checkedInAt: result.checkInAt ?? null,
      checkedOutAt: result.checkOutAt ?? null,
      durationMinutes: result.durationMinutes ?? null,
      durationFormatted: result.durationFormatted ?? null,
      isExpired: false,
      sessionId: result.sessionId,
      autoClosed: result.autoClosed,
      closeReason: result.closeReason,
    }

    // 4. RETURN APPROPRIATE HTTP STATUS
    switch (result.state) {
      case "NOT_FOUND":
        return NextResponse.json({ ...response, code: "NOT_FOUND" }, { status: 404 })
      case "INACTIVE":
        return NextResponse.json({ ...response, code: "MEMBER_INACTIVE" }, { status: 403 })
      default:
        return NextResponse.json(response)
    }

  } catch (error) {
    console.error("❌ Scan Error:", error)
    return NextResponse.json(
      { error: "Internal Error", code: "ATTENDANCE_SCAN_FAILED" },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed", code: "METHOD_NOT_ALLOWED" },
    { status: 405, headers: { Allow: "POST" } }
  )
}
