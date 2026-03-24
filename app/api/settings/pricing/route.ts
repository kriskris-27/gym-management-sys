import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PricingUpdateSchema } from "@/lib/validations"

const ORDER: ("MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING")[] = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
  "PERSONAL_TRAINING"
]

export async function GET() {
  try {
    const pricingFromDb = await prisma.planPricing.findMany({
      select: { membershipType: true, amount: true }
    })

    const dbMap = new Map(pricingFromDb.map((p: any) => [p.membershipType, p.amount]))

    const pricing = ORDER.map(type => ({
      membershipType: type,
      amount: dbMap.has(type) ? dbMap.get(type)! : 0
    }))

    return NextResponse.json({ pricing })
  } catch (error) {
    console.error("Failed to fetch pricing:", error)
    return NextResponse.json({ error: "Failed to fetch pricing" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const validated = PricingUpdateSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json({ error: "Invalid pricing details" }, { status: 400 })
    }

    const inputPricing = validated.data.pricing

    // Deduplicate by membershipType (last wins)
    const uniqueMap = new Map<"MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING", number>()
    for (const p of inputPricing) {
      uniqueMap.set(p.membershipType as "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING", p.amount)
    }

    const recordsToUpdate = Array.from(uniqueMap.entries()).map(([type, amount]) => ({
      membershipType: type,
      amount
    }))

    // Upsert concurrently
    await Promise.all(
      recordsToUpdate.map(p => 
        prisma.planPricing.upsert({
          where: { membershipType: p.membershipType },
          update: { amount: p.amount },
          create: { membershipType: p.membershipType, amount: p.amount }
        })
      )
    )

    // Re-fetch sorted to send back complete accurate dataset natively
    const pricingFromDb = await prisma.planPricing.findMany({
      select: { membershipType: true, amount: true }
    })
    
    // Sort array in memory
    const updatedPricing = ORDER
      .map(type => pricingFromDb.find((p: any) => p.membershipType === type) || { membershipType: type, amount: 0 })

    return NextResponse.json({ success: true, pricing: updatedPricing })

  } catch (error) {
    console.error("Failed to update pricing:", error)
    return NextResponse.json({ error: "Failed to update pricing" }, { status: 500 })
  }
}

