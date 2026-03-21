"use client"

import { useState, useEffect, use } from "react"
import { useRouter, useParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

interface Member {
  id: string
  name: string
  phone: string
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"
  startDate: string
  endDate: string
  status: "ACTIVE" | "INACTIVE" | "DELETED"
  createdAt: string
}

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
  mode: "CASH" | "UPI" | "CARD"
  date: string
  notes: string | null
}

const paymentSchema = z.object({
  amount: z.preprocess((val) => Number(val), z.number().min(1).max(99999)),
  date: z.string().min(1),
  mode: z.enum(["CASH", "UPI", "CARD"]),
  notes: z.string().max(500).optional()
})

const memberSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[^<>]*$/),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  membershipType: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL", "PERSONAL_TRAINING"]),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "DELETED"])
})

type PaymentFormData = z.infer<typeof paymentSchema>
type MemberFormData = z.infer<typeof memberSchema>

export default function MemberProfilePage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [member, setMember] = useState<Member | null>(null)
  const [attendance, setAttendance] = useState<{ records: AttendanceRecord[], total: number }>({ records: [], total: 0 })
  const [payments, setPayments] = useState<PaymentRecord[]>([])
  
  const [tab, setTab] = useState<"ATTENDANCE" | "PAYMENTS">("ATTENDANCE")
  const [attendancePage, setAttendancePage] = useState(1)
  const ATTENDANCE_LIMIT = 10

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)

  // Fetch logic
  const fetchMemberData = async () => {
    try {
      const [memRes, payRes] = await Promise.all([
        fetch(`/api/members/${id}`),
        fetch(`/api/payments?memberId=${id}`)
      ])
      
      if (memRes.status === 404) {
        setNotFound(true)
        setLoading(false)
        return
      }

      if (memRes.ok) {
        const memData = await memRes.json()
        setMember(memData.member || memData)
      }
      if (payRes.ok) {
        const payData = await payRes.json()
        setPayments(payData.payments)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttendance = async (page: number) => {
    try {
      const res = await fetch(`/api/attendance/${id}?page=${page}&limit=${ATTENDANCE_LIMIT}`)
      if (res.ok) {
        const data = await res.json()
        setAttendance({ records: data.records, total: data.total })
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (id) {
      fetchMemberData()
      fetchAttendance(1)
    }
  }, [id])

  useEffect(() => {
    if (id) {
      fetchAttendance(attendancePage)
    }
  }, [attendancePage])

  // Payment Form Hook
  const getTodayStr = () => new Date().toISOString().split("T")[0]
  const { register: regPayment, handleSubmit: handlePaymentSubmit, reset: resetPayment, formState: { errors: payErrors, isSubmitting: isPaying } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema) as any,
    defaultValues: { date: getTodayStr(), mode: "UPI" as any }
  })
  const [paymentSuccess, setPaymentSuccess] = useState(false)

  const onPaymentSubmit = async (data: PaymentFormData) => {
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, memberId: id })
      })
      if (res.ok) {
        setPaymentSuccess(true)
        fetchMemberData() // refresh payments
        setTimeout(() => {
          setShowPaymentModal(false)
          setPaymentSuccess(false)
          resetPayment()
        }, 1000)
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Edit Member Hook
  const { register: regEdit, handleSubmit: handleEditSubmit, reset: resetEdit, setValue: setEditVal, watch: watchEdit, formState: { errors: editErrors, isSubmitting: isEditing } } = useForm<MemberFormData>({
    resolver: zodResolver(memberSchema)
  })
  const [editSuccess, setEditSuccess] = useState(false)

  useEffect(() => {
    if (member && showEditModal) {
      resetEdit({
        name: member.name,
        phone: member.phone,
        membershipType: member.membershipType,
        startDate: member.startDate.split('T')[0],
        endDate: member.endDate.split('T')[0],
        status: member.status
      })
    }
  }, [member, showEditModal, resetEdit])

  const editMembershipType = watchEdit("membershipType")
  const editStartDate = watchEdit("startDate")
  useEffect(() => {
    if (editMembershipType !== "PERSONAL_TRAINING" && editStartDate) {
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
    try {
      const res = await fetch(`/api/members/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
      if (res.ok) {
        setEditSuccess(true)
        fetchMemberData()
        setTimeout(() => {
          setShowEditModal(false)
          setEditSuccess(false)
        }, 1000)
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Helpers
  const formatPlan = (plan: string) => {
    switch(plan) {
      case "MONTHLY": return "Monthly"; case "QUARTERLY": return "Quarterly"; 
      case "HALF_YEARLY": return "Half Yearly"; case "ANNUAL": return "Annual"; 
      case "PERSONAL_TRAINING": return "Personal Training"; default: return plan;
    }
  }
  const formatDate = (isoStr: string) => new Date(isoStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const formatTime = (isoStr: string) => new Date(isoStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  if (loading) {
    return (
      <div className="w-full min-h-screen bg-[#080808] p-8 text-white">
         <div className="bg-[#1C1C1C] animate-pulse h-[200px] rounded-xl mb-6" />
         <div className="bg-[#1C1C1C] animate-pulse h-[400px] rounded-xl" />
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

  const now = new Date()
  const isExpired = new Date(member.endDate) < now
  const daysLeft = Math.ceil((new Date(member.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 7
  const initial = member.name.charAt(0).toUpperCase()

  const totalPages = Math.ceil(attendance.total / ATTENDANCE_LIMIT) || 1

  return (
    <div className="w-full min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30 overflow-x-hidden">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-fade { animation: fadeIn 0.4s ease-out forwards; }
        .animate-tab { animation: fadeIn 0.2s ease-out forwards; }
        .animate-modal { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
      
      {/* TOP ROW: Header */}
      <div className="flex items-center justify-between mb-6 animate-fade">
        <button 
          onClick={() => router.push("/admin/members")}
          className="text-[#444444] text-[12px] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5 font-medium tracking-wide uppercase"
        >
          <span>←</span> Members
        </button>
        <button
          onClick={() => setShowEditModal(true)}
          className="bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] text-[12px] font-bold tracking-[0.1em] uppercase px-5 py-2.5 rounded-lg transition-all cursor-pointer"
        >
          Edit Member
        </button>
      </div>

      {/* MEMBER INFO CARD */}
      <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 flex flex-col md:flex-row gap-6 items-start animate-fade">
        <div className={`
          w-16 h-16 shrink-0 flex items-center justify-center rounded-full bg-[#1C1C1C]
          ${isExpired ? "border-2 border-[#D11F00]" : isExpiringSoon ? "border-2 border-[#FF6B00]" : ""}
        `}>
          <span className="text-white text-[24px] font-black">{initial}</span>
        </div>
        
        <div className="flex-1 w-full">
          <div className="mb-4">
            <h1 className="text-white text-[24px] font-black leading-tight tracking-tight">{member.name}</h1>
            <p className="text-[#444444] text-[13px] mt-1 font-medium">{member.phone}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Plan</p>
              <p className="text-white text-[13px] font-medium">{formatPlan(member.membershipType)}</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Status</p>
              {isExpired ? (
                <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">Expired</span>
              ) : member.status === "ACTIVE" ? (
                <span className="inline-block bg-[#10B981]/10 text-[#10B981] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#10B981]/20">Active</span>
              ) : (
                <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#2A2A2A]">Inactive</span>
              )}
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Joined</p>
              <p className="text-white text-[13px] font-medium">{formatDate(member.startDate)}</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Expires</p>
              <div className="flex flex-col">
                <span className="text-white text-[13px] font-medium">{formatDate(member.endDate)}</span>
                {isExpired ? (
                  <span className="text-[#D11F00] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">Expired {Math.abs(daysLeft)} days ago</span>
                ) : daysLeft <= 7 ? (
                  <span className="text-[#FF6B00] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">{daysLeft} days remaining — expiring soon!</span>
                ) : (
                  <span className="text-[#10B981] text-[12px] font-medium mt-0.5 leading-tight tracking-wide">{daysLeft} days remaining</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Sessions</p>
              <p className="text-white text-[13px] font-medium">{attendance.total} visits</p>
            </div>
            <div>
              <p className="text-[#333333] text-[10px] tracking-widest uppercase font-bold mb-1.5">Last Visit</p>
              <p className="text-white text-[13px] font-medium">
                {attendance.records[0] ? formatDate(attendance.records[0].checkedInAt) : "Never"}
              </p>
            </div>
          </div>
        </div>
      </div>

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
                  attendance.records.map((record) => {
                    const isOngoing = !record.checkedOutAt && !record.autoClosed;
                    const durationStr = record.durationMinutes 
                      ? `${Math.floor(record.durationMinutes / 60)}hr ${record.durationMinutes % 60}min`.replace("0hr ", "")
                      : "-";

                    return (
                      <tr key={record.id} className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors">
                        <td className="px-5 py-4 text-white text-[13px] font-medium whitespace-nowrap">
                          {formatDate(record.checkedInAt)}
                        </td>
                        <td className="px-5 py-4 text-[#666666] text-[12px] whitespace-nowrap">
                          {formatTime(record.checkedInAt)}
                        </td>
                        <td className="px-5 py-4 text-[#666666] text-[12px] whitespace-nowrap">
                          {record.checkedOutAt ? formatTime(record.checkedOutAt) : "-"}
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
              className="bg-[#D11F00] hover:bg-[#B51A00] text-white text-[11px] font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              + Add Payment
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[500px]">
              <thead className="border-b border-[#1C1C1C]">
                <tr>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-6 py-4 font-bold">Date</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-6 py-4 font-bold">Amount</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-6 py-4 font-bold">Mode</th>
                  <th className="text-[#333333] text-[10px] tracking-widest uppercase px-6 py-4 font-bold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-[#333333] text-[13px] font-medium">
                      No payments recorded yet
                    </td>
                  </tr>
                ) : (
                  payments.map(pay => {
                    const modeColor = pay.mode === "CASH" ? "bg-[#10B981]/10 text-[#10B981]" : pay.mode === "UPI" ? "bg-[#3B82F6]/10 text-[#3B82F6]" : "bg-[#8B5CF6]/10 text-[#8B5CF6]"
                    return (
                      <tr key={pay.id} className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors">
                        <td className="px-6 py-4 text-white text-[13px] font-medium whitespace-nowrap">
                          {formatDate(pay.date)}
                        </td>
                        <td className="px-6 py-4 text-white font-bold whitespace-nowrap">
                          ₹{pay.amount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`${modeColor} text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider`}>
                            {pay.mode}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#444444] text-[12px] italic max-w-[200px] truncate">
                          {pay.notes || "-"}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {payments.length > 0 && (
            <div className="border-t border-[#1C1C1C] px-6 py-4 flex items-center justify-between bg-[#0A0A0A]">
              <span className="text-[#444444] font-bold uppercase tracking-wider text-[11px]">Total Paid</span>
              <span className="text-white font-black text-[16px]">
                ₹{payments.reduce((sum, p) => sum + p.amount, 0).toLocaleString('en-IN')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ADD PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowPaymentModal(false)} />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 max-w-[400px] w-full relative z-10 animate-modal flex flex-col shadow-2xl shadow-black/50">
            <h2 className="text-white text-[18px] font-black tracking-tight mb-6">Add Payment</h2>
            
            <form onSubmit={handlePaymentSubmit(onPaymentSubmit as any)} className="space-y-5">
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Amount</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] font-medium text-[14px]">₹</span>
                  <input
                    {...regPayment("amount")}
                    type="number"
                    placeholder="2500"
                    className={`w-full bg-[#0F0F0F] border ${payErrors.amount ? 'border-[#D11F00]' : 'border-[#242424]'} text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 font-bold`}
                  />
                </div>
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

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPaying || paymentSuccess}
                  className={`flex-[2] text-white font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all duration-200 flex items-center justify-center
                    ${paymentSuccess ? "bg-[#10B981]" : "bg-[#D11F00] hover:bg-[#B51A00] active:scale-[0.98] cursor-pointer"}
                    ${(isPaying && !paymentSuccess) ? "opacity-70 cursor-not-allowed" : ""}
                  `}
                >
                  {paymentSuccess ? "Recorded ✓" : "Save Payment"}
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

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Status</label>
                <select
                  {...regEdit("status")}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer appearance-none"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="DELETED">Deleted (hide from lists)</option>
                </select>
              </div>

              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Membership Plan</label>
                <select
                  {...regEdit("membershipType")}
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg px-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all duration-200 cursor-pointer appearance-none"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="HALF_YEARLY">Half-Yearly</option>
                  <option value="ANNUAL">Annual</option>
                  <option value="PERSONAL_TRAINING">Personal Training</option>
                </select>
              </div>

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
                  <label className={`text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5 ${editMembershipType === "PERSONAL_TRAINING" ? "text-[#555555]" : "text-[#333333]"}`}>End Date</label>
                  <input
                    {...regEdit("endDate")}
                    type="date"
                    disabled={editMembershipType !== "PERSONAL_TRAINING"}
                    className={`w-full bg-[#0F0F0F] border border-[#242424] text-[14px] rounded-lg px-3 py-3 transition-all duration-200 [color-scheme:dark]
                      ${editMembershipType !== "PERSONAL_TRAINING" ? "text-[#555555] opacity-50 cursor-not-allowed" : "text-white focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none cursor-pointer"}
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
    </div>
  )
}
