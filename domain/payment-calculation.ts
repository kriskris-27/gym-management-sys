export type ComputedPayment = {
  baseAmount: number
  discountAmount: number
  finalAmount: number
  discountReason?: string
}

/**
 * Core discount math (pure): capped at 50% of base.
 */
export function computePaymentFromBase(
  baseAmount: number,
  memberDiscountPercent?: number,
  additionalDiscount?: number
): ComputedPayment {
  let totalDiscount = 0
  let discountReason = ""

  if (memberDiscountPercent && memberDiscountPercent > 0) {
    const memberDiscount = Math.round(baseAmount * (memberDiscountPercent / 100))
    totalDiscount += memberDiscount
    discountReason += `Member ${memberDiscountPercent}% off, `
  }

  if (additionalDiscount && additionalDiscount > 0) {
    totalDiscount += additionalDiscount
    discountReason += `Additional ₹${additionalDiscount} off, `
  }

  const maxDiscountPercent = 50
  const maxDiscountAbsolute = Math.round(baseAmount * 0.5)
  const percentageCap = Math.round(baseAmount * (maxDiscountPercent / 100))
  const finalDiscountCap = Math.min(percentageCap, maxDiscountAbsolute)

  totalDiscount = Math.min(totalDiscount, finalDiscountCap)
  const finalAmount = baseAmount - totalDiscount

  return {
    baseAmount,
    discountAmount: totalDiscount,
    finalAmount,
    discountReason: discountReason.trim() || undefined,
  }
}
