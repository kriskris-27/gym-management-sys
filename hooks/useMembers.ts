import { useQuery } from "@tanstack/react-query"

export function useMembers(search?: string, status?: string) {
  return useQuery({
    queryKey: ["members", search ?? "", status ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.append("search", search)
      if (status) params.append("status", status)
      const url = params.toString() ? `/api/members?${params.toString()}` : "/api/members"
      const res = await fetch(url)
      if (!res.ok) throw new Error("Failed to fetch members")
      return res.json()
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
