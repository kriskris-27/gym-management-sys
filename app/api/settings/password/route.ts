import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { requireAuthUser } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ChangePasswordSchema } from "@/lib/validations"

export async function POST(request: Request) {
  const auth = await requireAuthUser("POST /api/settings/password")
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const validated = ChangePasswordSchema.safeParse(body)
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.issues[0]?.message ?? "Invalid password payload", code: "VALIDATION" },
        { status: 400 }
      )
    }

    const { currentPassword, newPassword } = validated.data
    const user = await prisma.user.findUnique({
      where: { id: auth.user.userId },
      select: { id: true, password: true },
    })
    if (!user) {
      return NextResponse.json({ error: "User not found", code: "USER_NOT_FOUND" }, { status: 404 })
    }

    const ok = await bcrypt.compare(currentPassword, user.password)
    if (!ok) {
      return NextResponse.json(
        { error: "Current password is incorrect", code: "CURRENT_PASSWORD_INVALID" },
        { status: 400 }
      )
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to change password:", error)
    return NextResponse.json(
      { error: "Failed to change password", code: "PASSWORD_CHANGE_FAILED" },
      { status: 500 }
    )
  }
}

