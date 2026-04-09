/**
 * Validate payment amount (controlled validation).
 * BUSINESS RULE: Never "trust admin blindly"
 */
export function validatePaymentAmount(
  baseAmount: number,
  finalAmount: number,
  purpose: "SUBSCRIPTION" | "ADJUSTMENT" = "SUBSCRIPTION"
): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (finalAmount < 0) {
    errors.push("Final amount cannot be negative")
  }

  if (purpose === "SUBSCRIPTION" && finalAmount > baseAmount) {
    errors.push("Subscription payment cannot exceed base amount")
  }

  if (finalAmount > 99999) {
    errors.push("Payment amount exceeds maximum limit")
  }

  if (finalAmount > 0 && finalAmount < baseAmount * 0.1) {
    warnings.push("Payment amount is suspiciously low (less than 10% of base amount)")
  }

  if (finalAmount > 0 && finalAmount % 1 !== 0) {
    warnings.push("Payment amount has decimal places - consider rounding")
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
