import { NextResponse } from "next/server"
import { getActiveSubscription } from "../../../../../temp/domain/subscription"
import { getMemberSubscriptionFinancialSummary } from "../../../../../temp/domain/payment"

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

    // Authentication bypassed for development
    // TODO: Add proper authentication in production

    // Get active subscription for the member
    const activeSubscription = await getActiveSubscription(id)

    // Get financial summary
    const financialSummary = await getMemberSubscriptionFinancialSummary(id)

    // Determine member status based on subscription
    let memberStatus = "INACTIVE"
    let subscriptionInfo = null

    if (activeSubscription) {
      const now = new Date()
      if (activeSubscription.status === "ACTIVE" && activeSubscription.endDate >= now) {
        memberStatus = "ACTIVE"
      } else if (activeSubscription.status === "ACTIVE" && activeSubscription.endDate < now) {
        memberStatus = "EXPIRED"
      } else if (activeSubscription.status === "CANCELLED") {
        memberStatus = "CANCELLED"
      }

      subscriptionInfo = {
        id: activeSubscription.id,
        planName: activeSubscription.planNameSnapshot,
        planPrice: activeSubscription.planPriceSnapshot,
        startDate: activeSubscription.startDate,
        endDate: activeSubscription.endDate,
        status: activeSubscription.status
      }
    }

    const response = {
      memberId: id,
      status: memberStatus,
      subscription: subscriptionInfo,
      financial: {
        totalAmount: financialSummary.totalAmount,
        totalPaid: financialSummary.totalPaid,
        remaining: financialSummary.remaining,
        isPaidFull: financialSummary.isPaidFull
      },
      hasActiveSubscription: !!activeSubscription
    }

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
