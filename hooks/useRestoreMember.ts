import { useMutation, useQueryClient } from "@tanstack/react-query"

export function useRestoreMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" })
      })
      if (!res.ok) throw new Error("Failed to restore member")
      return res.json()
    },
    
    // Optimistic Update: Immediately remove the member from the current list (if it's the deleted view)
    onMutate: async (id) => {
       // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["members"] })
      
      // Snapshot the current state across all member query variations
      // (This is tricky because members query has search/status keys)
      // For now, simple invalidation is safer but we want "FEEL" faster
      
      return { id }
    },

    onSuccess: () => {
      // Refresh everything - members list, dashboard count, etc.
      queryClient.invalidateQueries({ queryKey: ["members"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    }
  })
}
