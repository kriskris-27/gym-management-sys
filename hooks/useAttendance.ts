import { useQuery } from "@tanstack/react-query"

export function useAttendanceToday() {
  return useQuery({
    queryKey: ["attendance", "today"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/today", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to fetch attendance")
      return res.json()
    },
    staleTime: 3 * 1000, 
    refetchInterval: 3 * 1000,
  })
}

export function useMemberAttendance(memberId: string, page: number = 1, limit: number = 10) {
  return useQuery({
    queryKey: ["attendance", "member", memberId, page],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${memberId}?page=${page}&limit=${limit}`)
      if (!res.ok) throw new Error("Failed to fetch member attendance")
      return res.json()
    },
    staleTime: 30 * 1000,
    enabled: !!memberId,
  })
}
