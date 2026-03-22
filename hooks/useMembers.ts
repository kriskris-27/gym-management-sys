import { useQuery } from "@tanstack/react-query"

export function useMembers(search?: string) {
  return useQuery({
    queryKey: ["members", search ?? ""],
    queryFn: async () => {
      const url = search
        ? `/api/members?search=${encodeURIComponent(search)}`
        : "/api/members"
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
