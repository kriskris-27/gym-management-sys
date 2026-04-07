import { useQuery } from "@tanstack/react-query"

/** Stable GET /api/members JSON shape (pagination always applied server-side). */
export interface MembersListResponse {
  members: unknown[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export function useMembers(options?: {
  search?: string
  status?: string
  page?: number
  limit?: number
}) {
  const search = options?.search
  const status = options?.status
  const page = options?.page ?? 1
  const limit = options?.limit ?? 50

  return useQuery({
    queryKey: ["members", search ?? "", status ?? "", page, limit],
    queryFn: async (): Promise<MembersListResponse> => {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (status) params.set("status", status)
      params.set("page", String(page))
      params.set("limit", String(limit))
      const res = await fetch(`/api/members?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch members")
      return res.json() as Promise<MembersListResponse>
    },
    staleTime: 60 * 1000,
  })
}

export function useMember(id: string) {
  return useQuery({
    queryKey: ["member", id],
    queryFn: async () => {
      const res = await fetch(`/api/members/${id}`)
      if (!res.ok) throw new Error("Failed to fetch member")
      return res.json()
    },
    staleTime: 60 * 1000,
    enabled: !!id,
  })
}
