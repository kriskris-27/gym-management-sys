import { useQuery } from "@tanstack/react-query"

export function useMonthlyReport(year: number, month: number) {
  return useQuery({
    queryKey: ["reports", "monthly", year, month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`)
      if (!res.ok) throw new Error("Failed to fetch monthly report")
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!year && !!month,
  })
}
