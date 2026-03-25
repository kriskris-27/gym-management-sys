import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AttendanceScanSchema } from "@/lib/validations"
import { z } from "zod"

interface ScanResponse {
  status: "CHECKED_IN" | "CHECKED_OUT" | "ALREADY_DONE" | "NOT_FOUND" | "INACTIVE"
  message: string
  memberName: string
  checkedInAt: string | null
  checkedOutAt: string | null
  durationMinutes: number | null
  durationFormatted: string | null
  isExpired: boolean
  autoReset?: boolean
}

export function useAttendanceScan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (phone: string) => {
      const validated = AttendanceScanSchema.safeParse({ phone })
      if (!validated.success) {
        throw new Error("Invalid phone number")
      }

      const response = await fetch("/api/attendance/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated.data)
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Scan failed")
      }

      return response.json() as Promise<ScanResponse>
    },

    // Immediately invalidate attendance data on successful scan
    onSuccess: () => {
      // Trigger immediate refetch of today's attendance
      queryClient.invalidateQueries({ queryKey: ["attendance", "today"] })
      
      // Also invalidate any member-specific attendance queries
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },

    // Optional: Handle errors if needed
    onError: (error) => {
      console.error("Attendance scan failed:", error)
    }
  })
}
