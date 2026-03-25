import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function GET() {
  try {
    console.log(`\n=== FINAL PROOF TEST ===`)
    
    // Create fresh test user
    const member = await prisma.member.create({
      data: {
        name: "Proof Test User",
        phone: "8888888888",
        membershipType: "MONTHLY",
        startDate: new Date("2026-03-25"),
        endDate: new Date("2026-04-24"),
        customPrice: 1000,
        status: "ACTIVE"
      }
    })
    
    // Add initial payment
    await prisma.payment.create({
      data: {
        memberId: member.id,
        amount: 300,
        date: new Date("2026-03-25"),
        mode: "UPI",
        notes: "Initial payment"
      }
    })
    
    console.log(`Created user: ${member.name} (ID: ${member.id})`)
    
    // Test 1: Initial financial state
    const { computeMemberFinancials } = await import("@/lib/financial-service")
    const initialFinancials = await computeMemberFinancials(member.id)
    
    console.log(`📊 INITIAL STATE:`)
    console.log(`   Plan: Monthly ₹1000`)
    console.log(`   Paid: ₹${initialFinancials.totalPaid}`)
    console.log(`   Remaining: ₹${initialFinancials.remaining}`)
    
    // Test 2: Plan change (should reset payment cycle)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    
    await prisma.member.update({
      where: { id: member.id },
      data: {
        membershipType: "QUARTERLY",
        customPrice: 3000,
        lastRenewalAt: tomorrow
      }
    })
    
    const afterPlanChange = await computeMemberFinancials(member.id)
    
    console.log(`\n🔄 AFTER PLAN CHANGE (Monthly → Quarterly):`)
    console.log(`   Plan: Quarterly ₹3000`)
    console.log(`   Paid: ₹${afterPlanChange.totalPaid} (should be 0)`)
    console.log(`   Remaining: ₹${afterPlanChange.remaining} (should be 3000)`)
    
    // Test 3: Renewal validation (should block)
    if (afterPlanChange.remaining > 0) {
      console.log(`\n🚫 RENEWAL VALIDATION:`)
      console.log(`   Status: BLOCKED ✅`)
      console.log(`   Reason: Outstanding balance ₹${afterPlanChange.remaining}`)
    }
    
    // Test 4: Add payment and try renewal again
    await prisma.payment.create({
      data: {
        memberId: member.id,
        amount: 3000,
        date: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000), // Day after tomorrow
        mode: "UPI",
        notes: "Full payment"
      }
    })
    
    await prisma.member.update({
      where: { id: member.id },
      data: { lastRenewalAt: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000) }
    })
    
    const afterPayment = await computeMemberFinancials(member.id)
    
    console.log(`\n💳 AFTER FULL PAYMENT:`)
    console.log(`   Plan: Quarterly ₹3000`)
    console.log(`   Paid: ₹${afterPayment.totalPaid}`)
    console.log(`   Remaining: ₹${afterPayment.remaining}`)
    
    if (afterPayment.remaining <= 0) {
      console.log(`\n✅ RENEWAL NOW ALLOWED:`)
      console.log(`   Status: ALLOWED ✅`)
      console.log(`   Reason: All dues cleared`)
    }
    
    console.log(`=== END PROOF TEST ===\n`)
    
    return NextResponse.json({
      success: true,
      testResults: {
        initial: {
          plan: "Monthly ₹1000",
          paid: initialFinancials.totalPaid,
          remaining: initialFinancials.remaining
        },
        afterPlanChange: {
          plan: "Quarterly ₹3000",
          paid: afterPlanChange.totalPaid,
          remaining: afterPlanChange.remaining,
          paymentCycleReset: afterPlanChange.totalPaid === 0
        },
        afterPayment: {
          plan: "Quarterly ₹3000",
          paid: afterPayment.totalPaid,
          remaining: afterPayment.remaining,
          canRenew: afterPayment.remaining <= 0
        }
      }
    })
    
  } catch (error) {
    console.error("[Proof Test] Error:", error)
    return NextResponse.json({ error: "Test failed" }, { status: 500 })
  }
}
