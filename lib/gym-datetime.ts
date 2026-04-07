import { DateTime } from "luxon"

/** All membership calendar boundaries and display use this zone (IST). */
export const GYM_TIMEZONE = "Asia/Kolkata"

function toGymZoned(value: Date | string): DateTime | null {
  if (value instanceof Date) {
    const d = DateTime.fromJSDate(value, { zone: "utc" }).setZone(GYM_TIMEZONE)
    return d.isValid ? d : null
  }
  const iso = DateTime.fromISO(String(value), { zone: "utc" })
  if (iso.isValid) return iso.setZone(GYM_TIMEZONE)
  const fallback = DateTime.fromJSDate(new Date(value), { zone: "utc" }).setZone(GYM_TIMEZONE)
  return fallback.isValid ? fallback : null
}

/**
 * True if "now" in the gym zone falls on or after the subscription start day
 * and on or before the subscription end day (inclusive of full end calendar day).
 */
export function subscriptionWindowCoversNow(start: Date, end: Date): boolean {
  const now = DateTime.now().setZone(GYM_TIMEZONE)
  const startZ = toGymZoned(start)
  const endZ = toGymZoned(end)
  if (!startZ || !endZ) return false
  const startDay = startZ.startOf("day")
  const endDay = endZ.endOf("day")
  return now >= startDay && now <= endDay
}

/** True after the end calendar day has fully ended in the gym zone. */
export function isMembershipEndPast(end: Date | string | null | undefined): boolean {
  if (end == null) return false
  const endZ = toGymZoned(end)
  if (!endZ) return false
  const now = DateTime.now().setZone(GYM_TIMEZONE)
  return now > endZ.endOf("day")
}

export type MembershipDayInfo = {
  isPastEnd: boolean
  /** Whole days until end-of-expiry day (inclusive of that day); 0 if past. */
  daysUntilEndInclusive: number
  /** Whole days after the end-of-expiry boundary if past. */
  daysSinceEnd: number
}

export function getMembershipDayInfo(end: Date | string | null | undefined): MembershipDayInfo {
  if (end == null) return { isPastEnd: false, daysUntilEndInclusive: 0, daysSinceEnd: 0 }
  const endZ = toGymZoned(end)
  if (!endZ) return { isPastEnd: false, daysUntilEndInclusive: 0, daysSinceEnd: 0 }
  const now = DateTime.now().setZone(GYM_TIMEZONE)
  const endBoundary = endZ.endOf("day")
  if (now <= endBoundary) {
    const days = Math.max(0, Math.ceil(endBoundary.diff(now).as("days")))
    return { isPastEnd: false, daysUntilEndInclusive: days, daysSinceEnd: 0 }
  }
  const daysAgo = Math.max(0, Math.floor(now.diff(endBoundary).as("days")))
  return { isPastEnd: true, daysUntilEndInclusive: 0, daysSinceEnd: daysAgo }
}

/** Today's calendar date in the gym zone as `YYYY-MM-DD` (for date inputs). */
export function todayYmdInIST(): string {
  return DateTime.now().setZone(GYM_TIMEZONE).toFormat("yyyy-LL-dd")
}

/**
 * Membership end instant: start of start-day in IST + `durationDays` calendar days (same rule as admin duration presets).
 * Stored `Date` is UTC from that IST midnight boundary for stable comparisons with `subscriptionWindowCoversNow`.
 */
export function membershipEndDateFromStartAndDurationDaysIST(
  start: Date,
  durationDays: number
): Date {
  const startZ = toGymZoned(start)
  if (!startZ || !startZ.isValid) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + durationDays)
    return d
  }
  return startZ.startOf("day").plus({ days: durationDays }).toUTC().toJSDate()
}

/** True if the membership start calendar day in IST is still strictly after "now" in IST. */
export function isMembershipStartInFutureIST(start: Date): boolean {
  const sz = toGymZoned(start)
  if (!sz) return false
  const now = DateTime.now().setZone(GYM_TIMEZONE)
  return now < sz.startOf("day")
}

export function formatMemberDate(value: Date | string | null | undefined): string {
  if (value == null) return "-"
  const d = toGymZoned(value)
  return d ? d.toFormat("d MMM yyyy") : "-"
}

export function formatMemberTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "-"
  const d = DateTime.fromISO(isoStr, { zone: "utc" }).setZone(GYM_TIMEZONE)
  return d.isValid ? d.toFormat("h:mm a") : "-"
}

export function formatMemberDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return "-"
  const d = DateTime.fromISO(isoStr, { zone: "utc" }).setZone(GYM_TIMEZONE)
  return d.isValid ? d.toFormat("d MMM yyyy 'at' h:mm a") : "-"
}

/**
 * Calendar date for `AttendanceSession.sessionDay` (@db.Date) — IST “today”, aligned with kiosk scan.
 */
export function getTodaySessionDayJS(): Date {
  return DateTime.now().setZone(GYM_TIMEZONE).startOf("day").toJSDate()
}

/** Parse `YYYY-MM-DD` query params as IST calendar day for `sessionDay` range filters. */
export function parseISTDateToSessionDay(isoDate: string): Date {
  const normalized = isoDate.length === 10 ? `${isoDate}T00:00:00` : isoDate
  return DateTime.fromISO(normalized, { zone: GYM_TIMEZONE }).startOf("day").toJSDate()
}

export function parseISTSessionDayRange(
  start?: string | null,
  end?: string | null
): { gte?: Date; lte?: Date } | undefined {
  if (!start?.trim() && !end?.trim()) return undefined
  const range: { gte?: Date; lte?: Date } = {}
  if (start?.trim()) range.gte = parseISTDateToSessionDay(start.trim())
  if (end?.trim()) range.lte = parseISTDateToSessionDay(end.trim())
  return range
}

// ---------------------------------------------------------------------------
// App-wide gym timezone (IST) — use these for UI instead of manual UTC offsets
// ---------------------------------------------------------------------------

/** Current instant in the gym zone (Luxon). */
export function gymNow(): DateTime {
  return DateTime.now().setZone(GYM_TIMEZONE)
}

/**
 * Parse a calendar `YYYY-MM-DD` string as a gym-local date (start of that day).
 * Returns null if the string is not a valid gym date.
 */
export function parseGymDateOnly(ymd: string): DateTime | null {
  const s = ymd.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = DateTime.fromISO(s, { zone: GYM_TIMEZONE }).startOf("day")
  return d.isValid ? d : null
}

/** Long weekday label for a gym calendar day, e.g. "Wednesday, 8 April 2026". */
export function formatGymDateLong(dt: DateTime): string {
  return dt.setZone(GYM_TIMEZONE).toFormat("cccc, d LLLL yyyy")
}

/** Format an instant (ISO string from DB) as time in the gym zone. */
export function formatGymTime(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null) return "—"
  const d =
    typeof isoOrDate === "string"
      ? DateTime.fromISO(isoOrDate, { zone: "utc" }).setZone(GYM_TIMEZONE)
      : DateTime.fromJSDate(isoOrDate, { zone: "utc" }).setZone(GYM_TIMEZONE)
  return d.isValid ? d.toFormat("h:mm a") : "—"
}

/** Format an instant as date + time in the gym zone. */
export function formatGymDateTime(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null) return "—"
  const d =
    typeof isoOrDate === "string"
      ? DateTime.fromISO(isoOrDate, { zone: "utc" }).setZone(GYM_TIMEZONE)
      : DateTime.fromJSDate(isoOrDate, { zone: "utc" }).setZone(GYM_TIMEZONE)
  return d.isValid ? d.toFormat("d MMM yyyy 'at' h:mm a") : "—"
}

/** Live clock string for headers, e.g. "3:45:02 PM". */
export function formatGymClock(dt?: DateTime): string {
  return (dt ?? gymNow()).toFormat("h:mm:ss a")
}

/** First calendar day of the month in the gym zone as `YYYY-MM-DD`. */
export function firstDayOfMonthYmdInGym(): string {
  return gymNow().startOf("month").toFormat("yyyy-LL-dd")
}
