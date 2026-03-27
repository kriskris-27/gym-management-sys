/**
 * Precise IST Date Windowing
 */
export function getISTDateRange() {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const istDateStr = istNow.toISOString().split("T")[0] // e.g. "2026-03-21"
  
  // IST midnight = UTC 18:30 of previous day
  const startOfTodayIST = new Date(istDateStr + "T00:00:00+05:30")
  const startOfTomorrowIST = new Date(startOfTodayIST.getTime() + 24 * 60 * 60 * 1000)
  
  return { startOfTodayIST, startOfTomorrowIST, istDateStr }
}

/**
 * Calculate distance between two dates in minutes
 */
export function calcDuration(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60000 // Return decimal minutes, not floored
}

/**
 * Format minutes into "1hr 23min" or "45min"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 0) return "0min"
  const hrs = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hrs === 0) return `${mins}min`
  if (mins === 0) return `${hrs}hr`
  return `${hrs}hr ${mins}min`
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

/**
 * Get plan duration in months for renewal calculations
 */
export function getPlanDurationMonths(membershipType: string): number {
  switch (membershipType) {
    case "MONTHLY": return 1
    case "QUARTERLY": return 3
    case "HALF_YEARLY": return 6
    case "ANNUAL": return 12
    case "PERSONAL_TRAINING": return 1
    default: return 1
  }
}
