"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getISTDateRange = getISTDateRange;
exports.calcDuration = calcDuration;
exports.formatDuration = formatDuration;
exports.withRetry = withRetry;
exports.getPlanDurationMonths = getPlanDurationMonths;
/**
 * Precise IST Date Windowing
 */
function getISTDateRange() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istDateStr = istNow.toISOString().split("T")[0]; // e.g. "2026-03-21"
    // IST midnight = UTC 18:30 of previous day
    const startOfTodayIST = new Date(istDateStr + "T00:00:00+05:30");
    const startOfTomorrowIST = new Date(startOfTodayIST.getTime() + 24 * 60 * 60 * 1000);
    return { startOfTodayIST, startOfTomorrowIST, istDateStr };
}
/**
 * Calculate distance between two dates in minutes
 */
function calcDuration(start, end) {
    return Math.floor((end.getTime() - start.getTime()) / 60000);
}
/**
 * Format minutes into "1hr 23min" or "45min"
 */
function formatDuration(minutes) {
    if (minutes < 0)
        return "0min";
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs === 0)
        return `${mins}min`;
    if (mins === 0)
        return `${hrs}hr`;
    return `${hrs}hr ${mins}min`;
}
/**
 * Safety net for transient DB timeouts
 */
async function withRetry(fn, retries = 1, delayMs = 1000) {
    try {
        return await fn();
    }
    catch (error) {
        if (retries > 0 && error?.code === "P2024") {
            console.warn("DB timeout — retrying once...");
            await new Promise((r) => setTimeout(r, delayMs));
            return withRetry(fn, retries - 1, delayMs);
        }
        throw error;
    }
}
/**
 * Get plan duration in months for renewal calculations
 */
function getPlanDurationMonths(membershipType) {
    switch (membershipType) {
        case "MONTHLY": return 1;
        case "QUARTERLY": return 3;
        case "HALF_YEARLY": return 6;
        case "ANNUAL": return 12;
        case "PERSONAL_TRAINING": return 1;
        default: return 1;
    }
}
