"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMemberDiscount = getMemberDiscount;
exports.getDiscountRules = getDiscountRules;
exports.calculatePayment = calculatePayment;
exports.validatePaymentAmount = validatePaymentAmount;
exports.createPayment = createPayment;
exports.getMemberPaymentHistory = getMemberPaymentHistory;
exports.getSubscriptionPaymentSummary = getSubscriptionPaymentSummary;
exports.getMemberSubscriptionFinancialSummary = getMemberSubscriptionFinancialSummary;
const prisma_optimized_1 = require("../lib/prisma-optimized");
const subscription_1 = require("./subscription");
/**
 * Get member-specific discount (rule-based + configurable)
 * BUSINESS RULE: Discount = function(memberHistory, context) NOT hardcoded
 * IMPLEMENTATION: Use Setting table for discount rules
 */
async function getMemberDiscount(memberId) {
    console.log(`[Payment Domain] Getting member discount for: ${memberId}`);
    // Get discount rules from settings
    const discountRules = await getDiscountRules();
    // Get member's payment history to determine status
    const paymentCount = await prisma_optimized_1.prisma.payment.count({
        where: {
            memberId,
            status: 'SUCCESS'
        }
    });
    // Get member's subscription history
    const subscriptionCount = await prisma_optimized_1.prisma.subscription.count({
        where: { memberId }
    });
    // Check if member had active subscription recently (last 90 days)
    const recentSubscription = await prisma_optimized_1.prisma.subscription.findFirst({
        where: {
            memberId,
            status: 'ACTIVE',
            endDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
        }
    });
    // Business logic for member classification
    const isNewMember = paymentCount === 0 && subscriptionCount <= 1;
    const isReturning = paymentCount > 0 && !recentSubscription;
    let discountPercent = 0;
    let discountReason = 'No discount';
    if (isNewMember) {
        discountPercent = discountRules.new_member;
        discountReason = `New member ${discountPercent}% off`;
    }
    else if (isReturning) {
        discountPercent = discountRules.returning_member;
        discountReason = `Returning member ${discountPercent}% off`;
    }
    console.log(`[Payment Domain] Member discount: ${discountPercent}% (${discountReason})`);
    return {
        discountPercent,
        discountReason,
        isNewMember
    };
}
/**
 * Get discount rules from settings
 */
async function getDiscountRules() {
    try {
        const newMemberRule = await prisma_optimized_1.prisma.setting.findUnique({
            where: { key: 'discount_new_member' }
        });
        const returningMemberRule = await prisma_optimized_1.prisma.setting.findUnique({
            where: { key: 'discount_returning_member' }
        });
        return {
            new_member: newMemberRule?.value || 10,
            returning_member: returningMemberRule?.value || 5
        };
    }
    catch {
        // Fallback to defaults
        return {
            new_member: 10,
            returning_member: 5
        };
    }
}
/**
 * Calculate payment amounts with controlled discounts
 * BUSINESS RULE: Never allow open-ended discounts
 * FINAL RULE: MAX_DISCOUNT = min(percentage cap, absolute cap)
 */
async function calculatePayment(subscriptionId, memberDiscountPercent, additionalDiscount) {
    console.log(`[Payment Domain] Calculating payment for subscription: ${subscriptionId}`);
    // Get subscription with plan details
    const subscription = await prisma_optimized_1.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true }
    });
    if (!subscription) {
        throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    // Base amount from subscription price snapshot
    const baseAmount = subscription.planPriceSnapshot;
    console.log(`[Payment Domain] Base amount from subscription: ${baseAmount}`);
    // Calculate total discount
    let totalDiscount = 0;
    let discountReason = '';
    // Member-specific discount (percentage)
    if (memberDiscountPercent && memberDiscountPercent > 0) {
        const memberDiscount = Math.round(baseAmount * (memberDiscountPercent / 100));
        totalDiscount += memberDiscount;
        discountReason += `Member ${memberDiscountPercent}% off, `;
    }
    // Additional flat discount
    if (additionalDiscount && additionalDiscount > 0) {
        totalDiscount += additionalDiscount;
        discountReason += `Additional ₹${additionalDiscount} off, `;
    }
    // Apply discount caps (percentage + absolute)
    const maxDiscountPercent = 50; // 50% max discount
    const maxDiscountAbsolute = Math.round(baseAmount * 0.5); // Max 50% of plan price
    const percentageCap = Math.round(baseAmount * (maxDiscountPercent / 100));
    const finalDiscountCap = Math.min(percentageCap, maxDiscountAbsolute);
    // Ensure discount doesn't exceed caps
    totalDiscount = Math.min(totalDiscount, finalDiscountCap);
    const finalAmount = baseAmount - totalDiscount;
    console.log(`[Payment Domain] Base: ${baseAmount}, Discount: ${totalDiscount}, Final: ${finalAmount}`);
    console.log(`[Payment Domain] Discount caps applied: Percentage(${percentageCap}), Absolute(${maxDiscountAbsolute}), Final(${finalDiscountCap})`);
    return {
        baseAmount,
        discountAmount: totalDiscount,
        finalAmount,
        discountReason: discountReason.trim() || undefined
    };
}
/**
 * Validate payment amount (controlled validation)
 * BUSINESS RULE: Never "trust admin blindly"
 * FINAL RULE: Payment must satisfy business constraints
 */
function validatePaymentAmount(baseAmount, finalAmount, purpose = 'SUBSCRIPTION') {
    const errors = [];
    const warnings = [];
    // Rule 1: Final amount must be non-negative
    if (finalAmount < 0) {
        errors.push('Final amount cannot be negative');
    }
    // Rule 2: Final amount cannot exceed base amount (for subscriptions)
    if (purpose === 'SUBSCRIPTION' && finalAmount > baseAmount) {
        errors.push('Subscription payment cannot exceed base amount');
    }
    // Rule 3: Final amount must be reasonable
    if (finalAmount > 99999) {
        errors.push('Payment amount exceeds maximum limit');
    }
    // Rule 4: Check for suspiciously low amounts
    if (finalAmount > 0 && finalAmount < baseAmount * 0.1) {
        warnings.push('Payment amount is suspiciously low (less than 10% of base amount)');
    }
    // Rule 5: Check for rounding issues
    if (finalAmount > 0 && finalAmount % 1 !== 0) {
        warnings.push('Payment amount has decimal places - consider rounding');
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}
/**
 * Create payment record with validation
 * BUSINESS RULE: Controlled validation before creation
 */
async function createPayment(memberId, subscriptionId, calculation, method, purpose = 'SUBSCRIPTION', notes) {
    console.log(`[Payment Domain] Creating payment for member: ${memberId}, subscription: ${subscriptionId}`);
    // Validate payment amount before creation
    const validation = validatePaymentAmount(calculation.baseAmount, calculation.finalAmount, purpose);
    if (!validation.isValid) {
        throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`);
    }
    // Log warnings if any
    if (validation.warnings.length > 0) {
        console.warn(`[Payment Domain] Payment warnings: ${validation.warnings.join(', ')}`);
    }
    const payment = await prisma_optimized_1.prisma.payment.create({
        data: {
            memberId,
            subscriptionId,
            baseAmount: calculation.baseAmount,
            discountAmount: calculation.discountAmount,
            finalAmount: calculation.finalAmount,
            method,
            status: 'SUCCESS',
            purpose,
            notes: notes || null
        }
    });
    console.log(`[Payment Domain] Created payment: ${payment.id}`);
    return payment;
}
/**
 * Get payment history for a member
 * OLD LOGIC: Complex date filtering based on lastRenewalAt
 * NEW LOGIC: Clear subscription association, optional filtering
 */
async function getMemberPaymentHistory(memberId, subscriptionId, startDate, endDate) {
    console.log(`[Payment Domain] Getting payment history for member: ${memberId}`);
    const where = { memberId };
    // Filter by subscription if provided
    if (subscriptionId) {
        where.subscriptionId = subscriptionId;
    }
    // Filter by date range if provided
    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate)
            where.createdAt.gte = startDate;
        if (endDate)
            where.createdAt.lte = endDate;
    }
    const payments = await prisma_optimized_1.prisma.payment.findMany({
        where,
        include: {
            subscription: {
                include: { plan: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
    console.log(`[Payment Domain] Found ${payments.length} payments`);
    return payments;
}
/**
 * Get payment summary for a subscription
 * OLD LOGIC: Complex aggregation with member-based filtering
 * NEW LOGIC: Clean subscription-based aggregation
 */
async function getSubscriptionPaymentSummary(subscriptionId) {
    console.log(`[Payment Domain] Getting payment summary for subscription: ${subscriptionId}`);
    const summary = await prisma_optimized_1.prisma.payment.aggregate({
        where: {
            subscriptionId,
            status: 'SUCCESS' // Only count successful payments
        },
        _sum: {
            baseAmount: true,
            discountAmount: true,
            finalAmount: true
        },
        _count: true
    });
    return {
        totalPayments: summary._count || 0,
        totalBaseAmount: summary._sum.baseAmount || 0,
        totalDiscountAmount: summary._sum.discountAmount || 0,
        totalFinalAmount: summary._sum.finalAmount || 0,
        paymentCount: summary._count || 0
    };
}
/**
 * Get comprehensive financial summary for a member's subscription
 * Includes total amount, paid amount, remaining balance, and payment status
 */
async function getMemberSubscriptionFinancialSummary(memberId) {
    console.log(`[Payment Domain] Getting financial summary for member: ${memberId}`);
    // Get active subscription for the member
    const activeSubscription = await (0, subscription_1.getActiveSubscription)(memberId);
    if (!activeSubscription) {
        // No active subscription - check payment history for any payments
        const paymentSummary = await prisma_optimized_1.prisma.payment.aggregate({
            where: {
                memberId,
                status: 'SUCCESS'
            },
            _sum: {
                finalAmount: true
            }
        });
        const totalPaid = paymentSummary._sum.finalAmount || 0;
        return {
            totalAmount: 0,
            totalPaid,
            remaining: 0,
            isPaidFull: totalPaid === 0 // Only paid full if no payments and no amount due
        };
    }
    // Get payment summary for the active subscription
    const subscriptionPaymentSummary = await getSubscriptionPaymentSummary(activeSubscription.id);
    const totalAmount = activeSubscription.planPriceSnapshot;
    const totalPaid = subscriptionPaymentSummary.totalFinalAmount;
    const remaining = totalAmount - totalPaid;
    const isPaidFull = remaining <= 0;
    return {
        totalAmount,
        totalPaid,
        remaining,
        isPaidFull,
        subscriptionId: activeSubscription.id,
        subscriptionStatus: activeSubscription.status
    };
}
