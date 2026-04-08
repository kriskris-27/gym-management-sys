import { NextResponse } from "next/server"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { GymProfileUpdateSchema } from "@/lib/validations"

const GYM_NAME_KEY = "gym_name"
const GYM_PHONE_KEY = "gym_phone"

export async function GET() {
  const auth = await requireAuthUser("GET /api/settings/profile")
  if (!auth.ok) return auth.response

  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: [GYM_NAME_KEY, GYM_PHONE_KEY] } },
      select: { key: true, value: true },
    })
    const map = new Map(rows.map((r) => [r.key, r.value]))
    const gymName = String(map.get(GYM_NAME_KEY) ?? "Royal Fitness")
    const gymPhone = String(map.get(GYM_PHONE_KEY) ?? "")

    return NextResponse.json({ gymName, gymPhone })
  } catch (error) {
    console.error("Failed to fetch gym profile settings:", error)
    return NextResponse.json(
      { error: "Failed to fetch gym profile", code: "PROFILE_FETCH_FAILED" },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuthUser("PUT /api/settings/profile")
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const validated = GymProfileUpdateSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.issues[0]?.message ?? "Invalid profile details", code: "VALIDATION" },
        { status: 400 }
      )
    }

    const { gymName, gymPhone } = validated.data
    await prisma.$transaction([
      prisma.setting.upsert({
        where: { key: GYM_NAME_KEY },
        update: { value: gymName },
        create: { key: GYM_NAME_KEY, value: gymName },
      }),
      prisma.setting.upsert({
        where: { key: GYM_PHONE_KEY },
        update: { value: gymPhone },
        create: { key: GYM_PHONE_KEY, value: gymPhone },
      }),
    ])

    return NextResponse.json({ success: true, gymName, gymPhone })
  } catch (error) {
    console.error("Failed to update gym profile settings:", error)
    return NextResponse.json(
      { error: "Failed to update gym profile", code: "PROFILE_UPDATE_FAILED" },
      { status: 500 }
    )
  }
}

