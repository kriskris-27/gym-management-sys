/**
 * TIME AUTHORITY: Single UTC Source with IST Display Conversion
 * All backend logic uses UTC, all display uses converted timezone
 */

import { DateTime } from "luxon"

// ========================================
// LUXON TIME AUTHORITY - SINGLE SOURCE OF TRUTH
// ========================================

/**
 * Get UTC date range for backend operations
 * Returns today and tomorrow in UTC
 */
export function getUTCDateRange() {
  const todayUTC = DateTime.utc().startOf('day')
  const tomorrowUTC = todayUTC.plus({ days: 1 })
  
  return {
    todayUTC,
    tomorrowUTC,
  }
}

/**
 * Convert UTC DateTime to display timezone (IST by default)
 */
export function toDisplayTimezone(utcDateTime: DateTime, timezone: string = "Asia/Kolkata") {
  return utcDateTime.setZone(timezone)
}

/**
 * Get display date string (YYYY-MM-DD format)
 */
export function getDisplayDateString(date: DateTime = DateTime.now(), timezone: string = "Asia/Kolkata") {
  return date.setZone(timezone).toFormat('yyyy-MM-dd')
}

/**
 * Get display time string (12-hour format with minutes)
 */
export function getDisplayTimeString(date: DateTime = DateTime.now(), timezone: string = "Asia/Kolkata") {
  return date.setZone(timezone).toFormat('h:mm a')
}

/**
 * Get display date and time (full datetime)
 */
export function getDisplayDateTime(date: DateTime = DateTime.now(), timezone: string = "Asia/Kolkata") {
  return date.setZone(timezone).toFormat('EEEE, d MMMM yyyy \'at\' hh:mm a')
}

/**
 * Get display time only (no date)
 */
export function getDisplayTimeOnly(date: DateTime = DateTime.now(), timezone: string = "Asia/Kolkata") {
  return date.setZone(timezone).toFormat('h:mm a')
}

/**
 * Log current India time with seconds using Luxon
 */
export function logIndiaTime(date: DateTime = DateTime.now()) {
  const indiaTime = date.setZone('Asia/Kolkata').toFormat('h:mm:ss a')
  console.log(`🕐 INDIA TIME: ${indiaTime}`)
  return indiaTime
}

/**
 * Create DateTime from ISO string (UTC)
 */
export function fromISO(isoString: string) {
  return DateTime.fromISO(isoString, { zone: 'utc' })
}

/**
 * Create DateTime from JavaScript Date
 */
export function fromDate(date: Date) {
  return DateTime.fromJSDate(date, { zone: 'utc' })
}

/**
 * Get current UTC DateTime
 */
export function nowUTC() {
  return DateTime.utc()
}

/**
 * Convert to ISO string for API responses
 */
export function toISOString(date: DateTime) {
  return date.toUTC().toISO()
}

// ========================================
// DURATION CALCULATIONS
// ========================================

/**
 * Calculate duration between two DateTimes in minutes
 */
export function calcDuration(startTime: DateTime, endTime: DateTime): number {
  return endTime.diff(startTime, 'minutes').minutes
}

/**
 * Format duration from fractional minutes (e.g. Luxon diff) to a readable string.
 * Under 1 minute → seconds; otherwise minutes/hours with seconds when needed.
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "—"
  const totalSeconds = Math.round(minutes * 60)
  if (totalSeconds < 60) return totalSeconds < 1 ? "<1s" : `${totalSeconds}s`

  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  if (h > 0) {
    return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ========================================
// PLAN DURATION CALCULATIONS
// ========================================

/**
 * Get plan duration in months
 */
export function getPlanDurationMonths(membershipType: string): number {
  switch (membershipType) {
    case "MONTHLY": return 1
    case "QUARTERLY": return 3
    case "HALF_YEARLY": return 6
    case "ANNUAL": return 12
    case "OTHERS": return 1
    default: return 1
  }
}

// ========================================
// LEGACY FUNCTIONS (deprecated)
// ========================================

/**
 * Legacy IST Date Range (deprecated - use getUTCDateRange instead)
 * @deprecated Use getUTCDateRange for backend logic, toDisplayTimezone for UI
 */
export function getISTDateRange() {
  console.warn("getISTDateRange is deprecated. Use getUTCDateRange for backend logic.")
  const { todayUTC, tomorrowUTC } = getUTCDateRange()
  return { 
    startOfTodayIST: todayUTC, 
    startOfTomorrowIST: tomorrowUTC, 
    istDateStr: toDisplayTimezone(todayUTC).toFormat('yyyy-MM-dd') 
  }
}

/**
 * Safety net for transient DB timeouts
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 1000
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries > 0 && (error as { code?: string })?.code === "P2024") {
      console.warn("DB timeout — retrying once...")
      await new Promise((r) => setTimeout(r, delayMs))
      return withRetry(fn, retries - 1, delayMs)
    }
    throw error
  }
}
