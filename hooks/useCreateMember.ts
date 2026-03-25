import { useMutation, useQueryClient } from "@tanstack/react-query"
import { MemberCreateSchema } from "@/lib/validations"
import { z } from "zod"

// Types for member data
interface Member {
  id: string
  name: string
  phone: string
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"
  startDate: string
  endDate: string
  status: "ACTIVE" | "INACTIVE" | "DELETED"
  createdAt: string
  totalPaid?: number
  totalAmount?: number
  remaining?: number
  isPaidFull?: boolean
}

interface MembersResponse {
  members: Member[]
}

// Hook for creating a member with optimistic updates
export function useCreateMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: z.infer<typeof MemberCreateSchema>) => {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create member")
      }

      return response.json() as Promise<{ member: Member }>
    },

    // Optimistic update - runs before the mutation
    onMutate: async (newMemberData) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["members"] })
      await queryClient.cancelQueries({ queryKey: ["dashboard"] })

      // Snapshot the previous value for rollback
      const previousMembers = queryClient.getQueryData<MembersResponse>(["members"])
      const previousDashboard = queryClient.getQueryData(["dashboard"])

      // Create optimistic member with proper ID
      const optimisticMember: Member = {
        id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Better unique ID
        name: newMemberData.name,
        phone: newMemberData.phone,
        membershipType: newMemberData.membershipType,
        startDate: newMemberData.startDate.toISOString().split('T')[0],
        endDate: newMemberData.endDate?.toISOString().split('T')[0] || '',
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        totalPaid: 0,
        totalAmount: newMemberData.customPrice || 1000, // Default price
        remaining: newMemberData.customPrice || 1000,
        isPaidFull: false
      }

      // Optimistically update the members cache
      queryClient.setQueryData<MembersResponse>(["members"], (old) => {
        if (!old) return { members: [optimisticMember] }
        return {
          members: [optimisticMember, ...old.members]
        }
      })

      // Return context with rollback data
      return { previousMembers, previousDashboard, optimisticMember }
    },

    // If mutation fails, rollback to previous state
    onError: (error, variables, context) => {
      if (context?.previousMembers) {
        queryClient.setQueryData(["members"], context.previousMembers)
      }
      if (context?.previousDashboard) {
        queryClient.setQueryData(["dashboard"], context.previousDashboard)
      }
    },

    // If mutation succeeds, update with real data
    onSuccess: (data, variables, context) => {
      // Replace optimistic member with real server data
      queryClient.setQueryData<MembersResponse>(["members"], (old) => {
        if (!old) return { members: [data.member] }
        
        // Find and replace the optimistic member
        const filtered = old.members.filter(m => m.id !== context?.optimisticMember?.id)
        return {
          members: [data.member, ...filtered]
        }
      })
    },

    // Always refetch after mutation settles (success or error)
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] })
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    }
  })
}
