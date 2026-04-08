import { useQuery } from "@tanstack/react-query"

export function useMonthlyReport(year: number, month: number) {
  return useQuery({
    queryKey: ["reports", "monthly", year, month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to fetch monthly report")
      return res.json()
    },
    staleTime: 0,
    // Production-friendly live updates:
    // - 3s when tab is active for near real-time UX
    // - 15s when hidden to reduce backend load
    refetchInterval: () =>
      typeof document !== "undefined" && document.hidden ? 15 * 1000 : 3 * 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    enabled: !!year && !!month,
  })
}
