import { useQuery } from "@tanstack/react-query"

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/summary", {
        credentials: 'include'
      })
      if (!res.ok) throw new Error("Failed to fetch dashboard")
      return res.json()
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })
}
