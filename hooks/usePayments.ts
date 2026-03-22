import { useQuery } from "@tanstack/react-query"

interface PaymentFilters {
  memberId?: string
  mode?: string
  startDate?: string
  endDate?: string
}

export function usePayments(filters?: PaymentFilters) {
  return useQuery({
    queryKey: ["payments", filters ?? {}],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.memberId) params.set("memberId", filters.memberId)
      if (filters?.mode && filters.mode !== "ALL") params.set("mode", filters.mode)
      if (filters?.startDate) params.set("startDate", filters.startDate)
      if (filters?.endDate) params.set("endDate", filters.endDate)
      const query = params.toString()
      const res = await fetch(`/api/payments${query ? `?${query}` : ""}`)
      if (!res.ok) throw new Error("Failed to fetch payments")
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}

export function usePaymentSummary(memberId: string) {
  return useQuery({
    queryKey: ["payments", "summary", memberId],
    queryFn: async () => {
      const res = await fetch(`/api/payments/summary/${memberId}`)
      if (!res.ok) throw new Error("Failed to fetch payment summary")
      return res.json()
    },
    staleTime: 30 * 1000,
    enabled: !!memberId,
  })
}
