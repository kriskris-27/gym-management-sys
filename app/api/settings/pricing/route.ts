import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
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
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      select: { name: true, price: true }
    })

    const dbMap = new Map(plans.map((p: any) => [p.name, p.price]))

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

    const DURATIONS: Record<string, number> = {
      "MONTHLY": 30,
      "QUARTERLY": 90,
      "HALF_YEARLY": 180,
      "ANNUAL": 365,
      "PERSONAL_TRAINING": 30 // Default for PT, can be adjusted
    }

    // Upsert the Plan table based on the pricing input
    await prisma.$transaction(
      inputPricing.map(p => 
        prisma.plan.upsert({
          where: { name: p.membershipType },
          update: { price: p.amount },
          create: { 
            name: p.membershipType, 
            price: p.amount,
            durationDays: DURATIONS[p.membershipType] || 30
          }
        })
      )
    )

    // Re-fetch sorted data to return
    const updatedPlans = await prisma.plan.findMany({
      where: { isActive: true },
      select: { name: true, price: true }
    })
    
    const updatedPricing = ORDER.map(type => {
      const found = updatedPlans.find((p: any) => p.name === type);
      return { membershipType: type, amount: found ? found.price : 0 };
    });

    return NextResponse.json({ success: true, pricing: updatedPricing })

  } catch (error) {
    console.error("Failed to update pricing:", error)
    return NextResponse.json({ error: "Failed to update pricing" }, { status: 500 })
  }
}
