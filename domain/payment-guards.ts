/** Rupee rounding slack used across global and per-plan payment guards. */
export const RUPEE_ROUND_SLACK = 1

/** Block any payment that would exceed total member liability (all non-cancelled subs). */
export function assertGlobalPaymentAllowed(args: {
  amount: number
  globalRemaining: number
}): { ok: true } | { ok: false; code: string; message: string } {
  const pay = Math.round(args.amount)
  const rem = args.globalRemaining
  if (rem <= RUPEE_ROUND_SLACK && pay > 0) {
    return {
      ok: false,
      code: "MEMBER_FULLY_PAID",
      message:
        "This member has no outstanding balance on the ledger. Remove or reduce the amount.",
    }
  }
  if (pay > rem + RUPEE_ROUND_SLACK) {
    return {
      ok: false,
      code: "OVERPAY_GLOBAL",
      message: `Amount (₹${pay}) exceeds total remaining balance (₹${Math.max(0, rem)}).`,
    }
  }
  return { ok: true }
}

export function assertNoCurrentPlanOverpay(args: {
  amount: number
  remaining: number
}): { ok: true } | { ok: false; code: string; message: string } {
  const pay = Math.round(args.amount)
  const rem = args.remaining
  if (rem <= RUPEE_ROUND_SLACK && pay > 0) {
    return {
      ok: false,
      code: "CURRENT_PLAN_FULLY_PAID",
      message:
        "This membership is already fully paid. You cannot record another payment against the current plan.",
    }
  }
  if (pay > rem + RUPEE_ROUND_SLACK) {
    return {
      ok: false,
      code: "OVERPAY_CURRENT_PLAN",
      message: `Amount (₹${pay}) is more than the balance for the current plan (₹${rem}).`,
    }
  }
  return { ok: true }
}
