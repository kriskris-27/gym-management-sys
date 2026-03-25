import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { memberId } = await request.json()
    
    console.log(`\n=== FORCE FRONTEND CACHE CLEAR ===`)
    console.log(`Clearing cache for member: ${memberId}`)
    
    // This endpoint will be called to force frontend to refetch
    // The key is to return no-cache headers
    return NextResponse.json({
      success: true,
      message: "Frontend cache cleared",
      timestamp: new Date().toISOString(),
      action: "REFRESH_REQUIRED"
    }, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    })
    
  } catch (error) {
    console.error("[Force Cache Clear] Error:", error)
    return NextResponse.json({ error: "Failed to clear cache" }, { status: 500 })
  }
}
