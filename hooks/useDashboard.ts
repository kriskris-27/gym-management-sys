import { useQuery } from "@tanstack/react-query"

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [summaryRes, todayRes] = await Promise.all([
        fetch("/api/dashboard/summary", { credentials: "include" }),
        fetch("/api/attendance/today", { credentials: "include", cache: "no-store" }),
      ])

      if (!summaryRes.ok) throw new Error("Failed to fetch dashboard summary")
      if (!todayRes.ok) throw new Error("Failed to fetch today's attendance")

      const summary = await summaryRes.json()
      const today = await todayRes.json()

      // Single source of truth for "today attendance" = /api/attendance/today
      return {
        ...summary,
        today: {
          ...summary.today,
          date: today.date,
          totalPresent: today.totalPresent,
          currentlyInside: today.currentlyInside,
          attendance: today.records ?? [],
        },
      }
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })
}
