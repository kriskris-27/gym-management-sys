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

export function useMemberAttendance(
  memberId: string,
  page: number = 1,
  limit: number = 10,
  options?: { live?: boolean }
) {
  const live = options?.live ?? false
  return useQuery({
    queryKey: ["attendance", "member", memberId, page],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${memberId}?page=${page}&limit=${limit}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to fetch member attendance")
      return res.json()
    },
    staleTime: live ? 0 : 30 * 1000,
    refetchInterval: live ? 2000 : false,
    refetchOnWindowFocus: true,
    enabled: !!memberId,
  })
}

export function useAttendanceByDate(date: string, options?: { live?: boolean }) {
  const live = options?.live ?? false
  return useQuery({
    queryKey: ["attendance", "history", date],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: date,
        endDate: date,
      })
      const res = await fetch(`/api/attendance/history?${params.toString()}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to fetch attendance history")
      return res.json()
    },
    staleTime: live ? 0 : 30 * 1000,
    refetchInterval: live ? 2000 : false,
    refetchOnWindowFocus: true,
    enabled: !!date,
  })
}
