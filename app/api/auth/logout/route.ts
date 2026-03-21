import { NextResponse } from "next/server"

/**
 * POST: Securely ends the owner's session
 * Logic: Deletes the "gym_token" cookie by instructing the browser to set its expiry to immediate zero.
 */
export async function POST() {
  const isProd = process.env.NODE_ENV === "production"
  
  const response = NextResponse.json({ success: true })
  
  // Wipe the jwt cookie immediately
  response.cookies.set("gym_token", "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  })

  return response
}

/**
 * GET: Blocked to prevent CSRF logout attacks
 * (Attacker cannot easily force a POST request via an image or simple link)
 */
export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { 
      status: 405,
      headers: { "Allow": "POST" }
    }
  )
}
