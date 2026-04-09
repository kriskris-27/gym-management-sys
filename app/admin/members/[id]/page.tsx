"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMember } from "@/hooks/useMembers"
import { usePayments, usePaymentSummary } from "@/hooks/usePayments"
import { useMemberAttendance } from "@/hooks/useAttendance"
import SpeedLoader from "@/app/components/SpeedLoader"
import {
  formatMemberDate,
  formatMemberTime,
  getMembershipDayInfo,
  todayYmdInIST,
} from "@/lib/gym-datetime"

interface AttendanceRecord {
  id: string
  date: string
  checkedInAt: string
  checkedOutAt: string | null
  durationMinutes: number | null
  autoClosed: boolean
}

interface PaymentRecord {
  id: string
  amount: number
  discountAmount?: number
  mode: "CASH" | "UPI" | "CARD"
  date: string
  notes: string | null
  subscriptionId?: string | null
  subscription?: {
    id: string
    planNameSnapshot: string
    startDate: string
    endDate: string
    status: string
  } | null
}

interface RenewalFormData {
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  startDate: string
  endDate?: string
  customPrice?: number
  manualPlanName?: string
  discountAmount?: number
  paidAmount?: number
  paymentMode?: "CASH" | "UPI" | "CARD"
}



interface RenewalPayload {
  action: "renew"
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  startDate: string
  endDate?: string
  customPrice?: number | undefined
  discountAmount?: number | undefined
  manualPlanName?: string
  paidAmount?: number
  paymentMode?: "CASH" | "UPI" | "CARD"
}



const paymentSchema = z.object({
  amount: z.union([z.string(), z.number()])
    .transform((val) => (typeof val === "string" ? parseFloat(val) : val))
    .pipe(z.number().min(1).max(99999)),
  date: z.string().min(1),
  mode: z.enum(["CASH", "UPI", "CARD"]),
  notes: z.string().optional()
})

const memberSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[^<>]*$/),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  membershipType: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "OTHERS"]),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  manualPlanName: z.string().optional(),
  manualAmount: z.number().optional(),
})

type PaymentFormData = z.input<typeof paymentSchema>
type MemberFormData = z.infer<typeof memberSchema>

export default function MemberProfilePage() {
  const router = useRouter()
  const params = useParams()
  const queryClient = useQueryClient()
  const id = params?.id as string

  // React Query hooks - replace manual fetch + useState
  const { data: memberData, isLoading: memberLoading, isError: memberError } = useMember(id, {
    live: true,
  })
  const { data: paymentsData, isLoading: paymentsLoading } = usePayments(
    { memberId: id },
    { live: true }
  )
  const { data: summaryData, isLoading: summaryLoading, error: summaryError } =
    usePaymentSummary(id, { live: true })
  const [attendancePage, setAttendancePage] = useState(1)
  const ATTENDANCE_LIMIT = 10
  const { data: attendanceData, isLoading: attendanceLoading } = useMemberAttendance(
    id,
    attendancePage,
    ATTENDANCE_LIMIT,
    { live: true }
  )

  // Debug payment summary hook
  useEffect(() => {
    console.log("🔍 Payment Summary Hook Debug:")
    console.log("  - summaryLoading:", summaryLoading)
    console.log("  - summaryError:", summaryError)
    console.log("  - summaryData:", summaryData)
    console.log("  - paymentSummary:", summaryData)
  }, [summaryLoading, summaryError, summaryData])

  // Extract data from hooks
  const member = memberData?.member || memberData
  const payments = paymentsData?.payments || []
  const paymentSummary = summaryData
  const attendance = attendanceData || { records: [], total: 0 }
  const loading = memberLoading || paymentsLoading || summaryLoading || attendanceLoading
  const notFound = memberError || (!memberLoading && !member)

  const endInfo = member
    ? getMembershipDayInfo(member.endDate)
    : { isPastEnd: false, daysUntilEndInclusive: 0, daysSinceEnd: 0 }
  const planUiState =
    !member
      ? "NEEDS_PLAN"
      : member.planUiState ??
        (member.subscriptionStatus === "ACTIVE" && member.endDate && !endInfo.isPastEnd
          ? "LIVE"
          : member.subscriptionStatus === "CANCELLED"
            ? "CANCELLED"
            : member.subscriptionStatus === "EXPIRED" || (member.endDate && endInfo.isPastEnd)
              ? "EXPIRED"
              : "NEEDS_PLAN")
  const needsPlan = planUiState === "NEEDS_PLAN"
  const isDeletedMember = member?.status === "DELETED"
  const isAddPlanMode = Boolean(isDeletedMember || needsPlan)

  // Debug paymentSummary changes
  useEffect(() => {
    console.log("👀 paymentSummary changed:", paymentSummary)
    console.log("👀 paymentSummary.totalAmount:", paymentSummary?.totalAmount)
    console.log("👀 paymentSummary.totalPaid:", paymentSummary?.totalPaid)
    console.log("👀 paymentSummary.remaining:", paymentSummary?.remaining)
  }, [paymentSummary])

  // Debug hook loading states
  useEffect(() => {
    console.log("🔄 summaryLoading:", summaryLoading)
    console.log("🔄 summaryData:", summaryData)
  }, [summaryLoading, summaryData])

  // UI State
  const [tab, setTab] = useState<"ATTENDANCE" | "PAYMENTS">("ATTENDANCE")

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showRenewalModal, setShowRenewalModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [reopenLoading, setReopenLoading] = useState(false)
  const [reopenError, setReopenError] = useState("")

  const [renewError, setRenewError] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Hash-based tab switching
  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.location.hash === "#payments") {
      setTab("PAYMENTS")
    }
  }, [id])

  // Dropdown close listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener("click", handleClickOutside)
    }
    return () => {
      document.removeEventListener("click", handleClickOutside)
    }
  }, [dropdownOpen])




  // Delete handler
  const handleDelete = async () => {
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "DELETE"
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["members"] })
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        router.push("/admin/members")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleReopenLastPlan = async () => {
    setReopenError("")
    setReopenLoading(true)
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen_last_plan" }),
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["member", id] })
        queryClient.invalidateQueries({ queryKey: ["members"] })
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        queryClient.invalidateQueries({ queryKey: ["payments"] })
        queryClient.invalidateQueries({ queryKey: ["payments", "summary", id] })
        queryClient.refetchQueries({ queryKey: ["member", id] })
      } else {
        const err = await res.json().catch(() => null)
        setReopenError(err?.error || "Could not reopen plan")
      }
    } catch (e) {
      console.error(e)
      setReopenError("Network error. Please try again.")
    } finally {
      setReopenLoading(false)
    }
  }

  // Payment Form Hook
  const getTodayStr = () => todayYmdInIST()
  const { register: regPayment, handleSubmit: handlePaymentSubmit, reset: resetPayment, watch: watchPayment, setValue: setPaymentValue, formState: { errors: payErrors, isSubmitting: isPaying } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { date: getTodayStr(), mode: "UPI" }
  })
  const watchedAmount = watchPayment("amount")
  console.log("[Payment Form] Watched amount:", watchedAmount)
  
  // Calculate live running total
  const [liveTotal, setLiveTotal] = useState<string | null>(null)
  
  useEffect(() => {
    console.log("[Live Total] useEffect triggered with:", { paymentSummary, watchedAmount })
    
    // Early return if no payment summary
    if (!paymentSummary) {
      setLiveTotal("Waiting for payment data...")
      return
    }
    
    // Handle empty or invalid amount
    const amount = Number(watchedAmount || 0)
    console.log("[Live Total] Processed amount:", amount)
    
    if (!amount || amount <= 0) {
      setLiveTotal("Enter an amount to see calculation")
      return
    }
    
    const currentRemaining = Number(paymentSummary.remaining || 0)
    const afterRemaining = currentRemaining - amount
    
    console.log("[Live Total] Calculation:", { currentRemaining, amount, afterRemaining })
    
    // Set result based on remaining amount
    let result = ""
    if (afterRemaining <= 0) {
      result = "After this: Fully paid ✓"
    } else if (afterRemaining < 0) {
      result = `After this: Overpaid by ₹${Math.abs(afterRemaining).toLocaleString('en-IN')}`
    } else {
      result = `After this: ₹${afterRemaining.toLocaleString('en-IN')} remaining`
    }
    
    console.log("[Live Total] Final result:", result)
    setLiveTotal(result)
  }, [paymentSummary, watchedAmount])
  console.log("[Payment Form] Form errors:", payErrors)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentError, setPaymentError] = useState("")

  const onPaymentSubmit = async (data: PaymentFormData) => {
    console.log("[Payment Submit] Starting submission with data:", data)
    setPaymentError("")
    try {
      const requestBody = { ...data, memberId: id }
      console.log("[Payment Submit] Request body:", requestBody)
      
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      })
      
      console.log("[Payment Submit] Response status:", res.status)
      console.log("[Payment Submit] Response OK:", res.ok)
      
      if (res.ok) {
        const responseData = await res.json()
        console.log("[Payment Submit] Success response:", responseData)
        setPaymentSuccess(true)
        
        console.log("[Payment Submit] Invalidating queries...")
        console.log("[Payment Submit] Current paymentSummary before invalidation:", paymentSummary)
        
        // Force immediate refetch instead of just invalidating
        queryClient.refetchQueries({ queryKey: ["payments"] })
        queryClient.refetchQueries({ queryKey: ["payments", "summary", id] })
        queryClient.refetchQueries({ queryKey: ["member", id] })
        queryClient.refetchQueries({ queryKey: ["members"] })
        queryClient.refetchQueries({ queryKey: ["dashboard"] })
        
        console.log("[Payment Submit] Forced refetch of all queries")
        
        setTimeout(() => {
          setShowPaymentModal(false)
          setPaymentSuccess(false)
          setPaymentError("")
          resetPayment()
        }, 2000) // Extended to 2 seconds to show success state
      } else {
        const errorData = await res.json()
        console.error("[Payment Submit] Error response:", errorData)
        setPaymentError(errorData.error || "Failed to save payment")
      }
    } catch (e) {
      console.error("[Payment Submit] Exception caught:", e)
      setPaymentError("Network error. Please try again.")
    }
  }

  // Edit Member Hook
  const { register: regEdit, handleSubmit: handleEditSubmit, reset: resetEdit, setValue: setEditVal, watch: watchEdit, formState: { errors: editErrors, isSubmitting: isEditing } } = useForm<MemberFormData>({
    resolver: zodResolver(memberSchema)
  })
  const [editSuccess, setEditSuccess] = useState(false)
  const [apiEditError, setApiEditError] = useState("")

  useEffect(() => {
    if (member && showEditModal) {
      resetEdit({
        name: member.name,
        phone: member.phone,
        membershipType: member.membershipType,
        startDate: member.startDate ? (typeof member.startDate === 'string' ? member.startDate.split('T')[0] : member.startDate.toISOString().split('T')[0]) : getTodayStr(),
        endDate: member.endDate ? (typeof member.endDate === 'string' ? member.endDate.split('T')[0] : member.endDate.toISOString().split('T')[0]) : "",
      })
    }
  }, [member, showEditModal, resetEdit])

  const editMembershipType = watchEdit("membershipType")
  const editStartDate = watchEdit("startDate")
  useEffect(() => {
    if (editMembershipType !== "OTHERS" && editStartDate) {
      const start = new Date(editStartDate)
      if (!isNaN(start.getTime())) {
        const durations: Record<string, number> = { MONTHLY: 30, QUARTERLY: 90, HALF_YEARLY: 180, ANNUAL: 365 }
        const days = durations[editMembershipType] || 30
        const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000)
        setEditVal("endDate", end.toISOString().split("T")[0])
      }
    }
  }, [editStartDate, editMembershipType, setEditVal])

  const onEditSubmit = async (data: MemberFormData) => {
    setApiEditError("")
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
      if (res.ok) {
        setEditSuccess(true)
        queryClient.invalidateQueries({ queryKey: ["member", id] })
        queryClient.invalidateQueries({ queryKey: ["members"] })
        queryClient.refetchQueries({ queryKey: ["member", id] })
        
        setTimeout(() => {
          setShowEditModal(false)
          setEditSuccess(false)
        }, 1000)
      } else {
        const err = await res.json()
        setApiEditError(err.error || "Update failed")
      }
    } catch (e) {
      console.error(e)
      setApiEditError("Network error. Please try again.")
    }
  }

  // Renewal Form Hook
  const [renewalSuccess, setRenewalSuccess] = useState(false)
  const { register: regRenewal, handleSubmit: handleRenewalSubmit, reset: resetRenewal, watch: watchRenewal, formState: { isSubmitting: isRenewing } } = useForm<RenewalFormData>({
    defaultValues: {
      membershipType:
        member?.membershipType && member.membershipType !== "NONE" ? member.membershipType : "MONTHLY",
      startDate: getTodayStr(),
      customPrice: undefined,
    },
  })
  const renewalMembershipType = watchRenewal("membershipType")
  const renewalStartDate = watchRenewal("startDate")
  const [calculatedEndDate, setCalculatedEndDate] = useState<string>("")

  useEffect(() => {
    if (renewalMembershipType !== "OTHERS" && renewalStartDate) {
      const start = new Date(renewalStartDate)
      if (!isNaN(start.getTime())) {
        const durations: Record<string, number> = { MONTHLY: 30, QUARTERLY: 90, HALF_YEARLY: 180, ANNUAL: 365 }
        const days = durations[renewalMembershipType as keyof typeof durations] || 30
        const end = new Date(start)
        end.setDate(start.getDate() + days)
        setCalculatedEndDate(end.toISOString().split("T")[0])
      }
    }
  }, [renewalMembershipType, renewalStartDate])

  useEffect(() => {
    if (member && showRenewalModal) {
      setCalculatedEndDate("")
      const toYmd = (d: string | Date | null | undefined) => {
        if (!d) return getTodayStr()
        if (typeof d === "string") return d.includes("T") ? d.split("T")[0] : d.split(" ")[0]
        return d.toISOString().split("T")[0]
      }
      resetRenewal({
        membershipType:
          member.membershipType && member.membershipType !== "NONE" ? member.membershipType : "MONTHLY",
        startDate: isAddPlanMode
          ? getTodayStr()
          : toYmd(member.endDate),
        customPrice: undefined,
      })
    }
  }, [member, showRenewalModal, resetRenewal, isAddPlanMode])

  const onRenewalSubmit = async (data: RenewalFormData) => {
    try {
      setRenewError("")

      // Deleted member flow: restore first, then add a new plan starting today (or chosen date).
      if (isDeletedMember) {
        const restoreRes = await fetch(`/api/members/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        })
        if (!restoreRes.ok) {
          const errorData = await restoreRes.json().catch(() => null)
          setRenewError(errorData?.error || "Failed to restore member")
          return
        }
      }

      const payload: RenewalPayload = {
        action: "renew",
        membershipType: data.membershipType,
        startDate: data.startDate,
        customPrice: data.customPrice ? Number(data.customPrice) : undefined,
        discountAmount: data.discountAmount ? Number(data.discountAmount) : 0,
        manualPlanName: data.manualPlanName,
        paidAmount: data.paidAmount ? Number(data.paidAmount) : 0,
        paymentMode: data.paymentMode || "CASH"
      }

      if (data.membershipType === "OTHERS" && data.endDate) {
        payload.endDate = data.endDate
      }
      const res = await fetch(`/api/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setRenewalSuccess(true)
        queryClient.invalidateQueries({ queryKey: ["member", id] })
        queryClient.invalidateQueries({ queryKey: ["members"] })
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        queryClient.invalidateQueries({ queryKey: ["payments", "summary", id] })
        setTimeout(() => {
          setShowRenewalModal(false)
          setRenewalSuccess(false)
          resetRenewal()
        }, 500)
      } else {
        const errorData = await res.json().catch(() => null)
        setRenewError(
          errorData?.error ||
            (res.status === 403
              ? "Cannot add this plan: member still has pending dues. Clear the previous balance first."
              : "Failed to renew membership")
        )
      }
    } catch (e) {
      console.error(e)
      setRenewError("A network error occurred. Please try again.")
    }
  }

  // Helpers
  const formatPlan = (plan: string) => {
    switch(plan) {
      case "MONTHLY": return "Monthly"; case "QUARTERLY": return "Quarterly"; 
      case "HALF_YEARLY": return "Half Yearly"; case "ANNUAL": return "Annual"; 
      case "OTHERS": return "Others"; default: return plan;
    }
  }
  const formatPaymentDate = (dateStr: string) => formatMemberDate(dateStr)


  if (loading) {
    return (
      <div className="w-full min-h-screen bg-[#080808] p-8 text-white flex flex-col items-center justify-center gap-3">
         <SpeedLoader />
         <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading member profile</p>
      </div>
    )
  }

  if (notFound || !member) {
    return (
      <div className="w-full min-h-screen bg-[#080808] p-8 text-white flex flex-col items-center">
         <p className="text-white text-[20px] font-bold text-center mt-16">Member not found</p>
         <button onClick={() => router.push("/admin/members")} className="mt-4 text-[#444444] text-[13px] hover:text-white transition-colors">
           ← Back to Members
         </button>
      </div>
    )
  }

  const isLivePlan = planUiState === "LIVE"
  const isCancelledPlan = planUiState === "CANCELLED"
  const isExpiredPlan = planUiState === "EXPIRED"
  const daysUntilEnd = endInfo.daysUntilEndInclusive
  const daysSinceEnd = endInfo.daysSinceEnd
  const isExpiringSoon =
    isLivePlan && !endInfo.isPastEnd && daysUntilEnd >= 0 && daysUntilEnd <= 7
  const shouldShowRenew = !isDeletedMember && isExpiredPlan && endInfo.isPastEnd
  const showReopenLastPlan =
    !isDeletedMember &&
    !isLivePlan &&
    !isCancelledPlan &&
    member.canReopenLastPlan === true

  const initial = member.name?.charAt(0).toUpperCase() || "?"

  const totalPages = Math.ceil(attendance.total / ATTENDANCE_LIMIT) || 1

  return (
    <div className="w-full min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30 overflow-x-hidden">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes slideDown { from { transform: translateY(-4px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-fade { animation: fadeIn 0.4s ease-out forwards; }
        .animate-tab { animation: fadeIn 0.2s ease-out forwards; }
        .animate-modal { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-dropdown { animation: slideDown 0.15s ease-out; }
      `}</style>
      
      {/* TOP ROW: Header */}
      <div className="flex items-center justify-between mb-6 animate-fade">
        <button 
          onClick={() => router.push("/admin/members")}
          className="text-[#444444] text-[12px] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 font-medium tracking-wide uppercase"
        >
          <span>←</span> Members
        </button>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setShowEditModal(true)}
            className="bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] text-[12px] font-bold tracking-widest uppercase px-5 py-2.5 rounded-lg transition-all cursor-pointer"
          >
            Edit
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="bg-[#D11F00]/10 border border-[#D11F00]/30 text-[#D11F00] hover:bg-[#D11F00]/20 hover:border-[#D11F00]/50 text-[12px] font-bold tracking-widest uppercase px-5 py-2.5 rounded-lg transition-all cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>


      {/* NO LIVE PLAN BANNER — Renew vs Switch is exclusive by planUiState */}
      {!isLivePlan && (
        <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl px-5 py-4 mb-4 flex justify-between items-center animate-fade">
          <div>
            <p className="text-[#F59E0B] font-bold text-[14px]">
              {isDeletedMember
                ? "⚠ Member Deleted"
                : isCancelledPlan
                ? "⚠ Plan Cancelled"
                : isExpiredPlan && endInfo.isPastEnd
                  ? "⚠ Membership Expired"
                  : "⚠ No Active Membership"}
            </p>
            <p className="text-[#888888] text-[12px] mt-0.5">
              {isDeletedMember
                ? "Add a new plan to restore this member back to ACTIVE."
                : isCancelledPlan
                ? "Use Add Plan to assign a new plan — previous payments count toward the global balance."
                : isExpiredPlan && endInfo.isPastEnd
                  ? `Expired on ${formatMemberDate(member.endDate)}`
                  : "Member needs a plan assignment to record attendance."}
            </p>
            {showReopenLastPlan && (
              <p className="text-[#666666] text-[11px] mt-2 leading-snug">
                The latest plan is marked expired but the end date (IST) hasn&apos;t passed yet — e.g. after a delete/restore. Reopen it or add a new plan.
              </p>
            )}
            {reopenError && (
              <p className="text-[#D11F00] text-[11px] mt-2 font-medium">{reopenError}</p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {shouldShowRenew && (
              <button
                onClick={() => {
                  setShowRenewalModal(true)
                }}
                className="themeFancyBtn cursor-pointer"
              >
                <span>Renew Plan</span>
              </button>
            )}
            {!shouldShowRenew && !isCancelledPlan && (
              <>
                {showReopenLastPlan && (
                  <button
                    type="button"
                    onClick={handleReopenLastPlan}
                    disabled={reopenLoading}
                    className="bg-transparent border border-[#F59E0B]/50 text-[#F59E0B] hover:bg-[#F59E0B]/10 font-bold text-[12px] uppercase tracking-wider px-4 py-2 rounded-lg transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reopenLoading ? "Reopening…" : "Reopen last plan"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowRenewalModal(true)
                  }}
                  className="themeFancyBtn cursor-pointer"
                >
                  <span>Add Plan</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}


      {/* MEMBER INFO CARD */}
      <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 flex flex-col md:flex-row gap-6 items-start animate-fade">
        <div className={`
          w-16 h-16 shrink-0 flex items-center justify-center rounded-full bg-[#1C1C1C]
          ${(isExpiredPlan && endInfo.isPastEnd) || (needsPlan && endInfo.isPastEnd) ? "border-2 border-[#D11F00]" : isCancelledPlan ? "border-2 border-[#F59E0B]" : isExpiringSoon ? "border-2 border-[#FF6B00]" : ""}
        `}>
          <span className="text-white text-[24px] font-black">{initial}</span>
        </div>
        
        <div className="flex-1 w-full">
          <div className="mb-4">
            <h1 className="text-white text-[24px] font-black leading-tight tracking-tight">{member.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <p className="text-[#444444] text-[13px] font-medium">{member.phone}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Plan</p>
              <p className="text-white text-[13px] font-medium">{formatPlan(member.membershipType)}</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Status</p>
              {isLivePlan ? (
                <span className="inline-block bg-[#10B981]/10 text-[#10B981] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#10B981]/20">Active</span>
              ) : isCancelledPlan ? (
                <span className="inline-block bg-[#F59E0B]/10 text-[#F59E0B] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#F59E0B]/20">Cancelled</span>
              ) : (isExpiredPlan && endInfo.isPastEnd) || (needsPlan && endInfo.isPastEnd) ? (
                <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">Expired</span>
              ) : (
                <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#2A2A2A]">Inactive</span>
              )}
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Joined</p>
              <p className="text-white text-[13px] font-medium">{formatMemberDate(member.startDate)}</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Expires</p>
              <div className="flex flex-col">
                <span className="text-white text-[13px] font-medium">{formatMemberDate(member.endDate)}</span>
                {endInfo.isPastEnd ? (
                  <span className="text-[#D11F00] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">
                    Expired {daysSinceEnd} day{daysSinceEnd === 1 ? "" : "s"} ago
                  </span>
                ) : isCancelledPlan && member.endDate && daysUntilEnd > 0 ? (
                  <span className="text-[#F59E0B] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">
                    {daysUntilEnd} day{daysUntilEnd === 1 ? "" : "s"} left on cancelled plan
                  </span>
                ) : isLivePlan && daysUntilEnd <= 7 ? (
                  <span className="text-[#FF6B00] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">
                    {daysUntilEnd} day{daysUntilEnd === 1 ? "" : "s"} remaining — expiring soon!
                  </span>
                ) : isLivePlan ? (
                  <span className="text-[#10B981] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">
                    {daysUntilEnd} day{daysUntilEnd === 1 ? "" : "s"} remaining
                  </span>
                ) : null}

              </div>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Sessions</p>
              <p className="text-white text-[13px] font-medium">{attendance.total} visits</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Last Visit</p>
              <p className="text-white text-[13px] font-medium">
                {attendance.records[0] ? formatMemberDate(attendance.records[0].checkedInAt) : "Never"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* PAYMENT SUMMARY CARD */}
      {summaryLoading ? (
        <div className="mt-4 bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 grid grid-cols-3 gap-4 z-10 relative">
          <div className="border-r border-[#1C1C1C] pr-4"><div className="bg-[#1C1C1C] h-16 rounded animate-pulse" /></div>
          <div className="border-r border-[#1C1C1C] px-4"><div className="bg-[#1C1C1C] h-16 rounded animate-pulse" /></div>
          <div className="pl-4"><div className="bg-[#1C1C1C] h-16 rounded animate-pulse" /></div>
        </div>
      ) : summaryError ? (
        <div className="mt-4 bg-[#111111] border border-[#D11F00]/20 rounded-xl p-5 text-center">
          <p className="text-[#D11F00] text-[14px]">Failed to load payment summary</p>
          <p className="text-[#666666] text-[12px] mt-1">{summaryError.message}</p>
        </div>
      ) : paymentSummary ? (
        <div className="mt-4 bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 animate-fade z-10 relative">
          <div className="grid grid-cols-3 gap-4">
            {/* CELL 1 */}
            <div className="border-r border-[#1C1C1C] pr-4">
              <p className="text-[#444444] text-[10px] tracking-widest uppercase mb-1 font-bold">Global Due Amount</p>
              {paymentSummary.totalAmount === 0 ? (
                <p className="text-white text-[24px] font-black">Free Plan</p>
              ) : (
                <p className="text-white text-[24px] font-black">₹{paymentSummary.totalAmount.toLocaleString('en-IN')}</p>
              )}
              <p className="text-[#333333] text-[11px] font-medium leading-tight mt-0.5">lifetime ledger across all non-cancelled plans</p>
            </div>

            {/* CELL 2 */}
            <div className="border-r border-[#1C1C1C] px-4">
              <p className="text-[#444444] text-[10px] tracking-widest uppercase mb-1 font-bold">Total Paid</p>
              <p className="text-[#10B981] text-[24px] font-black">₹{paymentSummary.totalPaid.toLocaleString('en-IN')}</p>
              {paymentSummary.totalPaid === 0 ? (
                <p className="text-[#333333] text-[11px] font-medium leading-tight mt-0.5">No payments yet</p>
              ) : (
                <p className="text-[#333333] text-[11px] font-medium leading-tight mt-0.5">
                  {payments.filter((p: PaymentRecord) => p.amount > 0).length} payment{payments.filter((p: PaymentRecord) => p.amount > 0).length === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {/* CELL 3 */}
            <div className="pl-4">
              <p className="text-[#444444] text-[10px] tracking-widest uppercase mb-1 font-bold">Global Remaining</p>
              {paymentSummary.remaining > 0 ? (
                <p className="text-[#D11F00] text-[24px] font-black leading-none pb-1.5 pt-0.5">₹{paymentSummary.remaining.toLocaleString('en-IN')}</p>
              ) : paymentSummary.remaining === 0 ? (
                <p className="text-[#10B981] text-[24px] font-black leading-none pb-1.5 pt-0.5">₹0</p>
              ) : (
                <p className="text-[#F59E0B] text-[24px] font-black leading-none pb-1.5 pt-0.5">Overpaid ₹{Math.abs(paymentSummary.remaining).toLocaleString('en-IN')}</p>
              )}

              <div className="mt-1">
                {paymentSummary.isPaidFull ? (
                  <span className="inline-block bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20 text-[11px] px-2 py-0.5 rounded-md font-medium tracking-wide">Fully Paid ✓</span>
                ) : (
                  <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] border border-[#D11F00]/20 text-[11px] px-2 py-0.5 rounded-md font-medium tracking-wide">₹{paymentSummary.remaining.toLocaleString('en-IN')} pending</span>
                )}
              </div>
            </div>
          </div>

          {/* Current plan strip */}
          {paymentSummary.currentPlanAmount > 0 && (
            <div className="mt-4 rounded-xl border border-[#242424] bg-[#0D0D0D] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[#666666] text-[10px] tracking-widest uppercase font-bold">
                  Current Plan Summary
                </p>
                <p className="text-[#333333] text-[10px] font-mono">
                  total ₹{Math.round(paymentSummary.currentPlanAmount).toLocaleString("en-IN")}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-[#1C1C1C] bg-[#111111] px-3 py-2">
                  <p className="text-[#444444] text-[10px] tracking-widest uppercase font-bold">Total</p>
                  <p className="text-white text-[14px] font-black">
                    ₹{Math.round(paymentSummary.currentPlanAmount).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="rounded-lg border border-[#10B981]/20 bg-[#10B981]/10 px-3 py-2">
                  <p className="text-[#10B981] text-[10px] tracking-widest uppercase font-bold">Paid</p>
                  <p className="text-[#10B981] text-[14px] font-black">
                    ₹{Math.max(0, Math.round(paymentSummary.currentPlanPaid ?? 0)).toLocaleString("en-IN")}
                  </p>
                </div>
                <div className="rounded-lg border border-[#D11F00]/20 bg-[#D11F00]/10 px-3 py-2">
                  <p className="text-[#D11F00] text-[10px] tracking-widest uppercase font-bold">Due</p>
                  <p className="text-[#D11F00] text-[14px] font-black">
                    ₹{Math.max(0, Math.round(paymentSummary.currentPlanRemaining ?? 0)).toLocaleString("en-IN")}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 text-center">
          <p className="text-[#666666] text-[14px]">No payment data available</p>
          <p className="text-[#444444] text-[12px] mt-1">Payment summary is empty</p>
        </div>
      )}

      {/* TABS */}
      <div className="mt-8 flex gap-6 animate-fade">
        <button 
          onClick={() => setTab("ATTENDANCE")}
          className={`font-medium text-[13px] transition-all duration-200 cursor-pointer pb-3 ${tab === "ATTENDANCE" ? "text-white border-b-2 border-[#D11F00]" : "text-[#444444] border-b-2 border-transparent hover:text-[#888888]"}`}
        >
          Attendance
        </button>
        <button 
          onClick={() => setTab("PAYMENTS")}
          className={`font-medium text-[13px] transition-all duration-200 cursor-pointer pb-3 ${tab === "PAYMENTS" ? "text-white border-b-2 border-[#D11F00]" : "text-[#444444] border-b-2 border-transparent hover:text-[#888888]"}`}
        >
          Payments
        </button>
      </div>

      {/* TAB 1: ATTENDANCE HISTORY */}
      {tab === "ATTENDANCE" && (
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl mt-4 overflow-hidden animate-tab flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead className="bg-[#0D0D0D] border-b border-[#1C1C1C]">
                <tr>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Date</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Check In</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Check Out</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Duration</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {attendance.records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#333333] text-[13px] font-medium">
                      No attendance records yet
                    </td>
                  </tr>
                ) : (
                  attendance.records.map((record: AttendanceRecord) => {
                    const isOngoing = !record.checkedOutAt && !record.autoClosed;
                    const durationStr = record.durationMinutes 
                      ? `${Math.floor(record.durationMinutes / 60)}hr ${record.durationMinutes % 60}min`.replace("0hr ", "")
                      : "-";

                    return (
                      <tr key={record.id} className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors">
                        <td className="px-5 py-4 text-white text-[13px] font-medium whitespace-nowrap">
                          {formatMemberDate(record.checkedInAt)}
                        </td>
                        <td className="px-5 py-4 text-[#666666] text-[12px] whitespace-nowrap">
                          {formatMemberTime(record.checkedInAt)}
                        </td>
                        <td className="px-5 py-4 text-[#666666] text-[12px] whitespace-nowrap">
                          {record.checkedOutAt ? formatMemberTime(record.checkedOutAt) : "-"}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          {isOngoing ? (
                            <span className="text-[#D11F00] text-[12px] font-bold tracking-wide">Ongoing</span>
                          ) : record.autoClosed ? (
                            <span className="text-[#444444] text-[12px] italic font-medium">Auto-closed</span>
                          ) : (
                            <span className="text-[#888888] text-[12px] font-medium">{durationStr}</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-[#444444] text-[12px] italic truncate max-w-[150px]">
                          {record.autoClosed ? "System fallback" : ""}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {attendance.records.length > 0 && (
            <div className="flex items-center justify-between px-5 py-4 border-t border-[#1C1C1C]">
              <button 
                onClick={() => setAttendancePage(p => Math.max(1, p - 1))}
                disabled={attendancePage === 1}
                className="text-[#444444] text-[12px] font-bold uppercase tracking-wider hover:text-white disabled:opacity-30 disabled:hover:text-[#444444] transition-colors cursor-pointer"
              >
                ← Prev
              </button>
              <span className="text-[#444444] text-[12px] font-medium">
                Page {attendancePage} of {totalPages}
              </span>
              <button 
                onClick={() => setAttendancePage(p => Math.min(totalPages, p + 1))}
                disabled={attendancePage === totalPages}
                className="text-[#444444] text-[12px] font-bold uppercase tracking-wider hover:text-white disabled:opacity-30 disabled:hover:text-[#444444] transition-colors cursor-pointer"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PAYMENTS */}
      {tab === "PAYMENTS" && (
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl mt-4 animate-tab overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#1C1C1C] bg-[#0D0D0D]">
            <h2 className="text-white font-bold text-[14px]">Payment History</h2>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="themeFancyBtn cursor-pointer"
            >
              <span>+ Add Payment</span>
            </button>
          </div>

          {payments.filter((p: PaymentRecord) => p.amount > 0).length === 0 ? (
            <div className="py-12 text-center text-[#333333] text-[13px] font-medium">
              No payments recorded yet
            </div>
          ) : (
            <div className="divide-y divide-[#1C1C1C]">
              {(
                Object.entries(
                  payments
                    .filter((p: PaymentRecord) => p.amount > 0)
                    .reduce((acc: Record<string, PaymentRecord[]>, p: PaymentRecord) => {
                      const key = p.subscription?.id ?? p.subscriptionId ?? "UNASSIGNED"
                      acc[key] = acc[key] ?? []
                      acc[key].push(p)
                      return acc
                    }, {})
                ) as [string, PaymentRecord[]][]
              )
                .sort(([aKey, aItems], [bKey, bItems]) => {
                  // Always keep unassigned bucket at the end.
                  if (aKey === "UNASSIGNED") return 1
                  if (bKey === "UNASSIGNED") return -1

                  const aSub = aItems[0]?.subscription
                  const bSub = bItems[0]?.subscription
                  const aTs = aSub?.startDate ? new Date(aSub.startDate).getTime() : 0
                  const bTs = bSub?.startDate ? new Date(bSub.startDate).getTime() : 0
                  // Most recent plan first.
                  if (bTs !== aTs) return bTs - aTs

                  // Tie-breaker 1: later plan end date first (helps current/longer active plan bubble up).
                  const aEndTs = aSub?.endDate ? new Date(aSub.endDate).getTime() : 0
                  const bEndTs = bSub?.endDate ? new Date(bSub.endDate).getTime() : 0
                  if (bEndTs !== aEndTs) return bEndTs - aEndTs

                  // Tie-breaker 2: latest payment date in group first.
                  const aLatestPayTs = Math.max(
                    ...aItems.map((p) => new Date(p.date).getTime())
                  )
                  const bLatestPayTs = Math.max(
                    ...bItems.map((p) => new Date(p.date).getTime())
                  )
                  return bLatestPayTs - aLatestPayTs
                })
                .map(([key, items]) => {
                const sub = items[0]?.subscription ?? null
                const total = items.reduce((s, p: PaymentRecord) => s + (p.amount || 0), 0)
                const totalDiscount = items.reduce(
                  (s, p: PaymentRecord) => s + (p.discountAmount || 0),
                  0
                )
                const label =
                  key === "UNASSIGNED"
                    ? "Unassigned payments"
                    : sub?.planNameSnapshot
                      ? sub.planNameSnapshot
                      : "Plan"

                const period =
                  sub?.startDate && sub?.endDate
                    ? `${formatMemberDate(sub.startDate)} → ${formatMemberDate(sub.endDate)}`
                    : null

                return (
                  <div key={key} className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <p className="text-white text-[13px] font-bold">{label}</p>
                        {period && (
                          <p className="text-[#444444] text-[11px] mt-0.5">{period}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[#444444] text-[10px] tracking-widest uppercase font-bold">
                          Total Paid
                        </p>
                        <p className="text-white text-[14px] font-black">
                          ₹{total.toLocaleString("en-IN")}
                        </p>
                        <p className="text-[#666666] text-[11px] mt-0.5">
                          Discount ₹{totalDiscount.toLocaleString("en-IN")}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left min-w-[520px]">
                        <thead className="border-y border-[#1C1C1C] bg-[#0D0D0D]">
                          <tr>
                            <th className="text-[#333333] text-[10px] tracking-widest uppercase px-4 py-3 font-bold">Date</th>
                            <th className="text-[#333333] text-[10px] tracking-widest uppercase px-4 py-3 font-bold">Amount</th>
                            <th className="text-[#333333] text-[10px] tracking-widest uppercase px-4 py-3 font-bold">Discount</th>
                            <th className="text-[#333333] text-[10px] tracking-widest uppercase px-4 py-3 font-bold">Mode</th>
                            <th className="text-[#333333] text-[10px] tracking-widest uppercase px-4 py-3 font-bold">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((pay: PaymentRecord) => {
                            const modeColor =
                              pay.mode === "CASH"
                                ? "bg-[#10B981]/10 text-[#10B981]"
                                : pay.mode === "UPI"
                                  ? "bg-[#3B82F6]/10 text-[#3B82F6]"
                                  : "bg-[#8B5CF6]/10 text-[#8B5CF6]"
                            return (
                              <tr key={pay.id} className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors">
                                <td className="px-4 py-3 text-white text-[13px] font-medium whitespace-nowrap">
                                  {formatPaymentDate(pay.date)}
                                </td>
                                <td className="px-4 py-3 text-white font-bold whitespace-nowrap">
                                  ₹{pay.amount.toLocaleString("en-IN")}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="text-[#F59E0B] text-[12px] font-bold">
                                    ₹{(pay.discountAmount || 0).toLocaleString("en-IN")}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className={`${modeColor} text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider`}>
                                    {pay.mode}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-[#444444] text-[12px] italic max-w-[240px] truncate">
                                  {pay.notes || "-"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {payments.length > 0 && (
            <div className="border-t border-[#1C1C1C] px-6 py-4 flex items-center justify-between bg-[#0A0A0A]">
              <div>
                <span className="text-[#444444] font-bold uppercase tracking-wider text-[11px]">Total Paid</span>
                <p className="text-[#666666] text-[11px] mt-1">
                  Discount Applied: ₹{payments.reduce((sum: number, p: PaymentRecord) => sum + (p.discountAmount || 0), 0).toLocaleString("en-IN")}
                </p>
              </div>
              <span className="text-white font-black text-[16px]">
                ₹{payments.reduce((sum: number, p: PaymentRecord) => sum + p.amount, 0).toLocaleString('en-IN')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ADD PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => { setShowPaymentModal(false); setPaymentError("") }} />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 max-w-[400px] w-full relative z-10 animate-modal flex flex-col shadow-2xl shadow-black/50">
            <h2 className="text-white text-[18px] font-black tracking-tight mb-4">Add Payment</h2>

            {/* REMAINING BALANCE BANNER */}
            {paymentSummary ? (
              <div className="bg-[#0F0F0F] border border-[#1C1C1C] rounded-lg px-4 py-3 mb-6 flex justify-between items-center">
                <span className="text-[#444444] text-[12px]">Remaining Balance</span>
                {Number(paymentSummary.remaining || 0) > 0 ? (
                  <span className="text-[#D11F00] text-[16px] font-black">₹{Number(paymentSummary.remaining || 0).toLocaleString('en-IN')}</span>
                ) : Number(paymentSummary.remaining || 0) === 0 ? (
                  <span className="text-[#10B981] text-[14px] font-bold">Fully Paid ✓</span>
                ) : (
                  <span className="text-[#F59E0B] text-[14px] font-bold">Overpaid by ₹{Math.abs(Number(paymentSummary.remaining || 0)).toLocaleString('en-IN')}</span>
                )}
              </div>
            ) : (
              <div className="bg-[#0F0F0F] border border-[#1C1C1C] rounded-lg px-4 py-3 mb-6 h-12 animate-pulse" />
            )}
            
            {(() => {
              const due = Math.max(0, Math.round(Number(paymentSummary?.remaining ?? 0)))
              const entered = Math.round(Number(watchPayment("amount") || 0))
              const overDue = due > 0 && entered > due
              const nothingDue = due <= 0
              return (
                <>
                  {nothingDue && (
                    <div className="bg-[#10B981]/10 border border-[#10B981]/20 rounded-lg px-4 py-3 mb-5">
                      <p className="text-[#10B981] text-[12px] font-medium">
                        No due amount pending. You can’t record a payment above ₹0.
                      </p>
                    </div>
                  )}
                  {overDue && (
                    <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg px-4 py-3 mb-5">
                      <p className="text-[#D11F00] text-[12px] font-medium">
                        Amount cannot exceed due amount (₹{due.toLocaleString("en-IN")}).
                      </p>
                    </div>
                  )}
                </>
              )
            })()}

            <form onSubmit={handlePaymentSubmit(onPaymentSubmit)} className="space-y-5">
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Amount</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                  <input
                    {...regPayment("amount", {
                      valueAsNumber: true, // Ensure value is treated as a number
                      onChange: (e) => {
                        const value = e.target.value
                        console.log("[Payment Form] Amount changed:", value)
                        const numValue = value === "" ? 0 : Number(value)
                        const due = Math.max(0, Math.round(Number(paymentSummary?.remaining ?? 0)))
                        const next = isNaN(numValue) ? 0 : Math.max(0, Math.round(numValue))
                        const clamped = due > 0 ? Math.min(next, due) : 0
                        setPaymentValue("amount", clamped, { shouldValidate: true })
                      }
                    })}
                    type="number"
                    min={0}
                    max={Math.max(0, Math.round(Number(paymentSummary?.remaining ?? 0)))}
                    placeholder="2500"
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                    }}
                    className={`w-full bg-[#0F0F0F] border ${payErrors.amount ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 font-bold`}
                  />
                </div>
                {/* Quick fill */}
                {paymentSummary && paymentSummary.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaymentValue("amount", Number(paymentSummary.remaining || 0))}
                    className="text-[#D11F00] text-[11px] mt-1.5 underline underline-offset-2 hover:text-[#FF3A1A] transition-colors cursor-pointer"
                  >
                    Pay remaining ₹{Number(paymentSummary.remaining || 0).toLocaleString('en-IN')}
                  </button>
                )}
                {/* Live running total */}
                {liveTotal ? (
                  <p className={`text-[11px] mt-1 ${
                    liveTotal.includes("Fully paid") ? "text-[#10B981]" : 
                    liveTotal.includes("Overpaid") ? "text-[#F59E0B]" : 
                    liveTotal.includes("Waiting") || liveTotal.includes("Enter") ? "text-[#666666]" :
                    "text-[#444444]"
                  }`}>
                    {liveTotal}
                  </p>
                ) : (
                  <p className="text-[#D11F00] text-[11px] mt-1">Debug: liveTotal is null</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Date</label>
                  <input
                    {...regPayment("date")}
                    type="date"
                    className={`w-full bg-[#0F0F0F] border ${payErrors.date ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-3 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 [color-scheme:dark] cursor-pointer`}
                  />
                </div>
                <div>
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Mode</label>
                  <select
                    {...regPayment("mode")}
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-3 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer appearance-none"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Notes (Optional)</label>
                <input
                  {...regPayment("notes")}
                  type="text"
                  placeholder="e.g. Month 1 payment"
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 placeholder:text-[#333333]"
                />
              </div>

              {/* Payment Error Display */}
              {paymentError && (
                <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg px-4 py-3">
                  <p className="text-[#D11F00] text-[12px] font-medium">{paymentError}</p>
                </div>
              )}

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowPaymentModal(false); setPaymentError("") }}
                  className="flex-1 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isPaying ||
                    paymentSuccess ||
                    Math.max(0, Math.round(Number(paymentSummary?.remaining ?? 0))) <= 0 ||
                    Math.round(Number(watchPayment("amount") || 0)) >
                      Math.max(0, Math.round(Number(paymentSummary?.remaining ?? 0)))
                  }
                  className={`themeFancyBtn flex-[2] py-3 flex items-center justify-center gap-2 ${paymentSuccess ? "themeFancyBtn--success" : isPaying ? "themeFancyBtn--loading" : paymentError ? "themeFancyBtn--error" : ""} ${(isPaying && !paymentSuccess) ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  {paymentSuccess ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Recorded ✓
                    </>
                  ) : isPaying ? (
                    <span className="flex items-center">
                      <span className="themeBtnMiniLoader"><span /><span /><span /></span>
                      <span>Processing...</span>
                    </span>
                  ) : (
                    "Save Payment"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENEWAL MODAL */}
      {showRenewalModal && member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={() => setShowRenewalModal(false)} />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 max-w-[440px] w-full relative z-10 animate-modal shadow-2xl shadow-black/50 overflow-y-auto max-h-[90vh]">
            <h2 className="text-white text-[20px] font-black tracking-tight">
              {isAddPlanMode ? "Add Plan" : "Renew Membership"}
            </h2>
            <p className="text-[#666666] text-[13px] mt-1 mb-6">{member.name}</p>
            
            <form onSubmit={handleRenewalSubmit(onRenewalSubmit)} className="space-y-5">
              {renewError && (
                <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg px-4 py-3">
                  <p className="text-[#D11F00] text-[12px] font-medium">{renewError}</p>
                </div>
              )}
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Plan</label>
                <select
                  {...regRenewal("membershipType")}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer appearance-none"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="HALF_YEARLY">Half-Yearly</option>
                  <option value="ANNUAL">Annual</option>
                  <option value="OTHERS">Others (Manual Entry)</option>
                </select>
              </div>

              {renewalMembershipType === "OTHERS" && (
                <div className="animate-fade">
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Custom Plan Name</label>
                  <input
                    {...regRenewal("manualPlanName")}
                    placeholder="e.g. Boxing 10 Sessions"
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 mb-4"
                  />
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Plan Amount (₹)</label>
                  <div className="relative mb-2">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                    <input
                      {...regRenewal("customPrice", { valueAsNumber: true })}
                      type="number"
                      min={0}
                      max={99999}
                      required
                      placeholder="Enter plan amount"
                      onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                      }}
                      className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 font-bold"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">
                  Start Date{" "}
                  <span className="text-[#10B981] ml-1 font-normal normal-case">
                    {isAddPlanMode
                      ? "(starts today)"
                      : "(≤28 days after last expiry → aligns to that date; else today)"}
                  </span>
                </label>
                <input
                  {...regRenewal("startDate")}
                  type="date"
                  disabled={!isAddPlanMode}
                  className={`w-full bg-[#0F0F0F] border border-[#242424] text-[14px] rounded-lg px-3 py-3 [color-scheme:dark] ${
                    !isAddPlanMode
                      ? "text-[#555555] opacity-50 cursor-not-allowed"
                      : "text-white focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981]/20 focus:outline-none cursor-pointer"
                  }`}
                />
              </div>

              <div>
                <label className={`text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5 ${renewalMembershipType === "OTHERS" ? "text-[#555555]" : "text-[#333333]"}`}>End Date</label>
                {renewalMembershipType === "OTHERS" ? (
                  <input
                    {...regRenewal("endDate")}
                    type="date"
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-3 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 [color-scheme:dark] cursor-pointer"
                    required
                  />
                ) : (
                  <input
                    type="text"
                    value={calculatedEndDate}
                    disabled
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-[#555555] text-[14px] rounded-lg px-3 py-3 opacity-50 cursor-not-allowed [color-scheme:dark]"
                  />
                )}
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Discount (₹)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                  <input
                    {...regRenewal("discountAmount", { valueAsNumber: true })}
                    type="number"
                    min={0}
                    max={99999}
                    placeholder="0"
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                    }}
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 font-bold"
                  />
                </div>
                <p className="text-[#444444] text-[10px] mt-1.5 font-medium">
                  Discount reduces dues without taking payment.
                </p>
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Paid Amount (Optional)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                  <input
                    {...regRenewal("paidAmount")}
                    type="number"
                    placeholder="Enter amount paid today"
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                    }}
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-[#10B981] text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#10B981] focus:ring-1 focus:ring-[#10B981]/20 focus:outline-none transition-all duration-200 font-bold"
                  />
                </div>
                <p className="text-[#444444] text-[10px] mt-1.5 font-medium">Leave as 0 if they haven&apos;t paid yet.</p>
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Payment Mode</label>
                <select
                  {...regRenewal("paymentMode")}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer appearance-none"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                </select>
              </div>


              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowRenewalModal(false)}
                  className="w-1/3 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenewing || renewalSuccess}
                  className={`themeFancyBtn w-2/3 py-3 flex items-center justify-center ${renewalSuccess ? "themeFancyBtn--success" : isRenewing ? "themeFancyBtn--loading" : renewError ? "themeFancyBtn--error" : ""} ${(isRenewing && !renewalSuccess) ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span>
                    {renewalSuccess ? "Renewed ✓" : isRenewing ? (
                      <span className="flex items-center">
                        <span className="themeBtnMiniLoader"><span /><span /><span /></span>
                        <span>Renewing...</span>
                      </span>
                    ) : "Renew"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MEMBER MODAL */}
      {showEditModal && member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowEditModal(false)} />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-8 max-w-[480px] w-full relative z-10 animate-modal shadow-2xl shadow-black/50 overflow-y-auto max-h-[90vh]">
            <h2 className="text-white text-[20px] font-black tracking-tight mb-6">Edit Member</h2>
            
            <form onSubmit={handleEditSubmit(onEditSubmit)} className="space-y-5">
              {apiEditError && (
                <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg p-3 text-[#D11F00] text-[12px] font-bold animate-fade">
                  ⚠ {apiEditError}
                </div>
              )}
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Full Name</label>
                <input
                  {...regEdit("name")}
                  className={`w-full bg-[#0F0F0F] border ${editErrors.name ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
                />
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Phone Number</label>
                <input
                  {...regEdit("phone")}
                  className={`w-full bg-[#0F0F0F] border ${editErrors.phone ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200`}
                />
              </div>

              <div className="rounded-lg border border-[#1F1F1F] bg-[#0F0F0F] px-4 py-3">
                <p className="text-[#999999] text-[11px] font-semibold uppercase tracking-[0.12em]">Status</p>
                <p className="mt-1 text-[13px] text-white">{member.status}</p>
                <p className="mt-1 text-[11px] text-[#666666]">
                  Status is controlled by subscriptions. Use Delete/Restore actions when needed.
                </p>
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Membership Plan</label>
                <select
                  {...regEdit("membershipType")}
                  disabled={paymentSummary && paymentSummary.totalPaid > 0}
                  className={`w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 appearance-none
                    ${paymentSummary && paymentSummary.totalPaid > 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                  `}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="HALF_YEARLY">Half-Yearly</option>
                  <option value="ANNUAL">Annual</option>
                  <option value="OTHERS">Others (Manual Entry)</option>
                </select>
                {paymentSummary && paymentSummary.totalPaid > 0 && (
                  <p className="text-[#D11F00] text-[10px] mt-1.5 font-medium italic">Plan cannot be changed after payments are made. Use Renewal/Cancel instead.</p>
                )}
              </div>


              {editMembershipType === "OTHERS" && (
                <div className="space-y-5 animate-fade">
                  <div>
                    <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Custom Plan Name</label>
                    <input
                      {...regEdit("manualPlanName")}
                      placeholder="e.g. Cricket Coaching"
                      className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200"
                    />
                  </div>
                  <div>
                    <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Plan Amount</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                      <input
                        {...regEdit("manualAmount", { valueAsNumber: true })}
                        type="number"
                        placeholder="5000"
                        disabled={paymentSummary && paymentSummary.totalPaid > 0}
                        onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                        }}
                        className={`w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 font-medium
                          ${paymentSummary && paymentSummary.totalPaid > 0 ? "opacity-50 cursor-not-allowed" : ""}
                        `}
                      />
                    </div>
                  </div>

                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Start Date</label>
                  <input
                    {...regEdit("startDate")}
                    type="date"
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-3 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 [color-scheme:dark] cursor-pointer"
                  />
                </div>
                <div>
                  <label className={`text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5 ${editMembershipType === "OTHERS" ? "text-[#555555]" : "text-[#333333]"}`}>End Date</label>
                  <input
                    {...regEdit("endDate")}
                    type="date"
                    disabled={editMembershipType !== "OTHERS"}
                    className={`w-full bg-[#0F0F0F] border border-[#242424] text-[14px] rounded-lg px-3 py-3 transition-all duration-200 [color-scheme:dark]
                      ${editMembershipType !== "OTHERS" ? "text-[#555555] opacity-50 cursor-not-allowed" : "text-white focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none cursor-pointer"}
                    `}
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="w-1/3 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing || editSuccess}
                  className={`w-2/3 text-white font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 flex items-center justify-center
                    ${editSuccess ? "bg-[#10B981]" : "bg-[#D11F00] hover:bg-[#B51A00] active:scale-[0.98] cursor-pointer"}
                    ${(isEditing && !editSuccess) ? "opacity-70 cursor-not-allowed" : ""}
                  `}
                >
                  {editSuccess ? "Updated ✓" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={() => setShowDeleteModal(false)} />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 max-w-[400px] w-full relative z-10 animate-modal shadow-2xl shadow-black/50">
            <h2 className="text-white text-[18px] font-black tracking-tight">Delete Member</h2>
            
            <p className="text-[#444444] text-[13px] mt-3">
              Are you sure you want to delete <span className="font-bold text-white">{member.name}</span>?
            </p>

            <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg px-4 py-3 mt-4">
              <p className="text-[#D11F00] text-[12px]">
                Their attendance and payment history will be preserved but they will be hidden from all lists.
              </p>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-widest uppercase px-6 py-3 rounded-lg transition-all duration-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className={`flex-1 text-white font-black text-[12px] tracking-widest uppercase px-6 py-3 rounded-lg transition-all duration-200 flex items-center justify-center
                  ${deleteLoading ? "bg-[#D11F00] opacity-70 cursor-not-allowed" : "bg-[#D11F00] hover:bg-[#B51A00] active:scale-[0.98] cursor-pointer"}
                `}
              >
                {deleteLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
