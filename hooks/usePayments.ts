import { useQuery } from "@tanstack/react-query"

interface PaymentFilters {
  memberId?: string
  mode?: string
  startDate?: string
  endDate?: string
}

export function usePayments(filters?: PaymentFilters, options?: { live?: boolean }) {
  const live = options?.live ?? false
  return useQuery({
    queryKey: ["payments", filters ?? {}],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.memberId) params.set("memberId", filters.memberId)
      if (filters?.mode && filters.mode !== "ALL") params.set("mode", filters.mode)
      if (filters?.startDate) params.set("startDate", filters.startDate)
      if (filters?.endDate) params.set("endDate", filters.endDate)
      const query = params.toString()
      const res = await fetch(`/api/payments${query ? `?${query}` : ""}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to fetch payments")
      return res.json()
    },
    staleTime: live ? 0 : 30 * 1000,
    refetchInterval: live ? 2000 : false,
    refetchOnWindowFocus: true,
  })
}

export function usePaymentSummary(memberId: string, options?: { live?: boolean }) {
  const live = options?.live ?? false
  return useQuery({
    queryKey: ["payments", "summary", memberId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/summary/${memberId}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Failed to fetch payment summary")
      return res.json()
    },
    staleTime: live ? 0 : 30 * 1000,
    refetchInterval: live ? 1000 : false,
    refetchOnWindowFocus: true,
    enabled: !!memberId,
  })
}
