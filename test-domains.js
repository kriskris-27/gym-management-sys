import { scanMember } from "./domain/attendance.ts"
import { getMemberSubscriptionFinancialSummary } from "./domain/payment.ts"
import { getActiveSubscription } from "./domain/subscription.ts"

async function testDomainFunctions() {
  console.log("🧪 Testing Domain Functions")
  console.log("=" .repeat(50))

  // Test 1: Attendance Domain
  console.log("\n1. Testing Attendance Domain...")
  try {
    const result = await scanMember("1234567890")
    console.log("✅ Attendance scan result:", result.state, "-", result.message)
  } catch (error) {
    console.log("❌ Attendance scan error:", error.message)
  }

  // Test 2: Payment Domain
  console.log("\n2. Testing Payment Domain...")
  try {
    const result = await getMemberSubscriptionFinancialSummary("test-member-id")
    console.log("✅ Payment summary result:", {
      totalAmount: result.totalAmount,
      totalPaid: result.totalPaid,
      remaining: result.remaining,
      isPaidFull: result.isPaidFull
    })
  } catch (error) {
    console.log("❌ Payment summary error:", error.message)
  }

  // Test 3: Subscription Domain
  console.log("\n3. Testing Subscription Domain...")
  try {
    const result = await getActiveSubscription("test-member-id")
    console.log("✅ Active subscription result:", result ? "Found" : "Not found")
  } catch (error) {
    console.log("❌ Active subscription error:", error.message)
  }

  console.log("\n" + "=" .repeat(50))
  console.log("🎯 Domain Testing Complete!")
}

testDomainFunctions().catch(console.error)
