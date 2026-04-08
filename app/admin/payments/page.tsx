"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { usePayments } from "@/hooks/usePayments"
import { firstDayOfMonthYmdInGym, todayYmdInIST } from "@/lib/gym-datetime"
import type { MemberFinancials } from "@/lib/financial-service"
import SpeedLoader from "@/app/components/SpeedLoader"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Payment {
  id: string
  memberId: string
  memberName: string
  amount: number
  mode: "CASH" | "UPI" | "CARD"
  date: string
  notes: string | null
}

interface MemberResult {
  id: string
  name: string
  phone: string
  membershipType: string
}

type PaymentSummary = MemberFinancials

function formatPaymentDate(dateStr: string): string {
  if (!dateStr) return "—"
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr
  const [year, month, day] = datePart.split("-")
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

const Spinner = () => (
  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
)

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  // Filters
  const [search, setSearch] = useState("")
  const [modeFilter, setModeFilter] = useState("All")
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthYmdInGym())
  const [dateTo, setDateTo] = useState(todayYmdInIST())

  // Data via React Query (server-side mode/date filtering)
  const { data: rawPaymentsData, isLoading: loading } = usePayments({
    mode: modeFilter,
    startDate: dateFrom,
    endDate: dateTo,
  })
  const payments: Payment[] = rawPaymentsData?.payments ?? []

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [memberSearch, setMemberSearch] = useState("")
  const [memberResults, setMemberResults] = useState<MemberResult[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberResult | null>(null)
  const [selectedSummary, setSelectedSummary] = useState<PaymentSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [modalAmount, setModalAmount] = useState("")
  const [modalDate, setModalDate] = useState(todayYmdInIST())
  const [modalMode, setModalMode] = useState<"CASH" | "UPI" | "CARD">("UPI")
  const [modalNotes, setModalNotes] = useState("")
  const [modalError, setModalError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const memberSearchRef = useRef<HTMLDivElement>(null)

  // ─── Client-side filtering ────────────────────────────────────────────────

  const filtered = payments.filter((p) => {
    // Hide zero-amount payments from the global ledger
    if (p.amount <= 0) return false
    
    const matchesSearch = p.memberName.toLowerCase().includes(search.toLowerCase())
    return matchesSearch
  })

  // ─── Stats (same dataset logic as table) ──────────────────────────────────

  const rangeTotal = filtered.reduce((s, p) => s + p.amount, 0)
  const rangeCount = filtered.length

  const validPaymentsCount = filtered.length
  const allTimeTotal = filtered.reduce((s, p) => s + p.amount, 0)
  const cashTotal = filtered.filter((p) => p.mode === "CASH").reduce((s, p) => s + p.amount, 0)
  const upiTotal = filtered.filter((p) => p.mode === "UPI").reduce((s, p) => s + p.amount, 0)
  const cardTotal = filtered.filter((p) => p.mode === "CARD").reduce((s, p) => s + p.amount, 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080808] p-8 text-white flex flex-col items-center justify-center gap-3">
        <SpeedLoader />
        <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading payments</p>
      </div>
    )
  }

  // ─── Member search in modal ───────────────────────────────────────────────

  const searchMembers = async (query: string) => {
    if (query.length < 2) {
      setMemberResults([])
      setShowDropdown(false)
      return
    }
    try {
      const res = await fetch(
        `/api/members?search=${encodeURIComponent(query)}&limit=6&page=1`
      )
      if (res.ok) {
        const data = await res.json()
        setMemberResults((data.members ?? []).slice(0, 6))
        setShowDropdown(true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const selectMember = async (m: MemberResult) => {
    setSelectedMember(m)
    setMemberSearch(m.name)
    setShowDropdown(false)
    setSummaryLoading(true)
    setSelectedSummary(null)
    try {
      const res = await fetch(`/api/payments/summary/${m.id}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedSummary(data)
        // Quick-fill remaining if pending
        if (data.remaining > 0) {
          setModalAmount(String(data.remaining))
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSummaryLoading(false)
    }
  }

  const resetModal = () => {
    setMemberSearch("")
    setMemberResults([])
    setSelectedMember(null)
    setSelectedSummary(null)
    setModalAmount("")
    setModalDate(todayYmdInIST())
    setModalMode("UPI")
    setModalNotes("")
    setModalError("")
    setSaveSuccess(false)
    setShowDropdown(false)
  }

  const openModal = () => {
    resetModal()
    setShowModal(true)
  }

  const handleSave = async () => {
    setModalError("")
    if (!selectedMember) { setModalError("Select a member first"); return }
    const amt = Number(modalAmount)
    if (!modalAmount || isNaN(amt) || amt <= 0) { setModalError("Enter a valid amount greater than ₹0"); return }
    if (amt > 99999) { setModalError("Amount too high (max ₹99,999)"); return }
    const due = Math.max(0, Math.round(Number(selectedSummary?.remaining ?? 0)))
    if (due <= 0) { setModalError("No due amount pending for this member."); return }
    if (amt > due) { setModalError(`Amount cannot exceed due amount (₹${due.toLocaleString("en-IN")}).`); return }
    if (!modalDate) { setModalError("Select a date"); return }

    setSaving(true)
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: selectedMember.id,
          amount: amt,
          date: modalDate,
          mode: modalMode,
          notes: modalNotes || undefined,
        }),
      })
      if (res.ok) {
        setSaveSuccess(true)
        queryClient.invalidateQueries({ queryKey: ["payments"] })
        queryClient.invalidateQueries({ queryKey: ["payments", "summary", selectedMember.id] })
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        queryClient.invalidateQueries({ queryKey: ["members"] })
        queryClient.invalidateQueries({ queryKey: ["member", selectedMember.id] })
        setTimeout(() => {
          setShowModal(false)
          resetModal()
        }, 1200)
      } else {
        const json = await res.json()
        setModalError(json.error || "Failed to save payment")
      }
    } catch {
      setModalError("Network error. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  // Live running total calc
  const enteredAmt = Number(modalAmount) || 0
  const dueAmount = Math.max(0, Math.round(Number(selectedSummary?.remaining ?? 0)))
  const overDue = dueAmount > 0 && enteredAmt > dueAmount
  const afterRemaining = Math.max(0, (selectedSummary?.remaining ?? 0) - enteredAmt)

  // ─── Mode badge helper ────────────────────────────────────────────────────

  const modeBadge = (mode: string) => {
    const map: Record<string, string> = {
      CASH: "bg-[#10B981]/10 text-[#10B981]",
      UPI: "bg-[#3B82F6]/10 text-[#3B82F6]",
      CARD: "bg-[#8B5CF6]/10 text-[#8B5CF6]",
    }
    const labels: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" }
    return (
      <span className={`${map[mode] ?? ""} text-[11px] px-2.5 py-1 rounded-md font-medium`}>
        {labels[mode] ?? mode}
      </span>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-page { animation: fadeIn 0.4s ease-out forwards; }
        .animate-modal { animation: scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      {/* ── TOP ROW ── */}
      <div className="flex items-start justify-between animate-page">
        <div>
          <h1 className="text-white text-[28px] font-black tracking-tight">Payments</h1>
          <p className="text-[#444444] text-[13px] mt-1">All payment records</p>
        </div>
        <button
          onClick={openModal}
          className="themeFancyBtn px-5 py-2.5 cursor-pointer"
        >
          <span>+ Record Payment</span>
        </button>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-3 gap-4 mt-6 animate-page">
        {/* Selected Range */}
        <div className="themeFxCardOuter h-[132px]">
          <div className="themeFxCard h-[130px]">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">Selected Range</p>
              {loading ? (
                <div className="bg-[#1C1C1C] h-9 w-28 rounded animate-pulse mb-2" />
              ) : (
                <p className="text-white text-[32px] font-black leading-none">
                  ₹{rangeTotal.toLocaleString("en-IN")}
                </p>
              )}
              <p className="text-[#c9c9c9] text-[11px] mt-2">{loading ? "—" : `${rangeCount} transactions`}</p>
            </div>
          </div>
        </div>

        {/* By Mode */}
        <div className="themeFxCardOuter h-[132px]">
          <div className="themeFxCard h-[130px]">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">By Mode</p>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="bg-[#1C1C1C] h-5 rounded animate-pulse" />)}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[#c9c9c9] text-[12px]">Cash</span>
                    <span className="text-[#10B981] text-[12px] font-medium">₹{cashTotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#c9c9c9] text-[12px]">UPI</span>
                    <span className="text-[#3B82F6] text-[12px] font-medium">₹{upiTotal.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#c9c9c9] text-[12px]">Card</span>
                    <span className="text-[#8B5CF6] text-[12px] font-medium">₹{cardTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Filtered Total */}
        <div className="themeFxCardOuter h-[132px]">
          <div className="themeFxCard h-[130px]">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">Filtered Total</p>
              {loading ? (
                <div className="bg-[#1C1C1C] h-9 w-28 rounded animate-pulse mb-2" />
              ) : (
                <p className="text-white text-[32px] font-black leading-none">
                  ₹{allTimeTotal.toLocaleString("en-IN")}
                </p>
              )}
              <p className="text-[#c9c9c9] text-[11px] mt-2">{loading ? "—" : `${validPaymentsCount} total transactions`}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── FILTER ROW ── */}
      <div className="mt-6 flex gap-3 items-center flex-wrap animate-page">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[280px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#333333]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search member..."
            className="w-full bg-[#111111] border border-[#1C1C1C] text-white text-[13px] pl-9 pr-4 py-2.5 rounded-lg placeholder:text-[#333333] focus:border-[#D11F00] focus:outline-none transition-colors duration-200"
          />
        </div>

        {/* Mode Tabs */}
        <div className="flex bg-[#111111] border border-[#1C1C1C] rounded-lg p-1">
          {["All", "Cash", "UPI", "Card"].map((tab) => (
            <button
              key={tab}
              onClick={() => setModeFilter(tab)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200 whitespace-nowrap cursor-pointer
                ${modeFilter === tab
                  ? "bg-[#1C1C1C] text-white border border-[#2A2A2A]"
                  : "bg-transparent text-[#444444] border border-transparent hover:text-[#888888]"}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <span className="text-[#444444] text-[11px] font-medium">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-[#111111] border border-[#1C1C1C] text-white text-[12px] px-3 py-2 rounded-lg focus:border-[#D11F00] focus:outline-none transition-colors [color-scheme:dark] cursor-pointer"
          />
          <span className="text-[#444444] text-[11px] font-medium">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-[#111111] border border-[#1C1C1C] text-white text-[12px] px-3 py-2 rounded-lg focus:border-[#D11F00] focus:outline-none transition-colors [color-scheme:dark] cursor-pointer"
          />
        </div>
      </div>

      {/* ── PAYMENTS TABLE ── */}
      <div className="mt-4 bg-[#111111] border border-[#1C1C1C] rounded-xl overflow-hidden animate-page">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[700px]">
            <thead className="bg-[#0D0D0D] border-b border-[#1C1C1C]">
              <tr>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Member</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Amount</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Mode</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Date</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Notes</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#0D0D0D]">
                    <td colSpan={6} className="px-5 py-3">
                      <div className="bg-[#1C1C1C] animate-pulse h-10 rounded" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <p className="text-[#333333] text-[14px] font-medium">No payments found</p>
                    <p className="text-[#2A2A2A] text-[12px] mt-1">Try adjusting your filters or date range</p>
                  </td>
                </tr>
              ) : (
                filtered.map((pay) => {
                  const initial = pay.memberName.charAt(0).toUpperCase()
                  return (
                    <tr key={pay.id} className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors duration-150 group">
                      {/* Member */}
                      <td
                        className="px-5 py-4 cursor-pointer"
                        onClick={() => router.push(`/admin/members/${pay.memberId}`)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-[#1C1C1C] border border-[#242424]">
                            <span className="text-white text-[12px] font-bold">{initial}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-white text-[13px] font-medium leading-tight group-hover:text-[#D11F00] transition-colors">
                              {pay.memberName}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-4">
                        <span className="text-white text-[13px] font-bold">
                          ₹{pay.amount.toLocaleString("en-IN")}
                        </span>
                      </td>

                      {/* Mode */}
                      <td className="px-5 py-4">{modeBadge(pay.mode)}</td>

                      {/* Date */}
                      <td className="px-5 py-4">
                        <span className="text-[#666666] text-[12px]">{formatPaymentDate(pay.date)}</span>
                      </td>

                      {/* Notes */}
                      <td className="px-5 py-4 max-w-[180px]">
                        {pay.notes ? (
                          <span className="text-[#444444] text-[12px] italic truncate block">{pay.notes}</span>
                        ) : (
                          <span className="text-[#333333] text-[12px]">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-5 py-4">
                        <button
                          onClick={() => router.push(`/admin/members/${pay.memberId}`)}
                          className="text-[#444444] text-[12px] font-medium hover:text-[#D11F00] transition-colors cursor-pointer flex items-center gap-1"
                        >
                          View
                          <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer */}
        {!loading && (
          <div className="border-t border-[#1C1C1C] px-5 py-3 flex items-center justify-between bg-[#0A0A0A]">
            <span className="text-[#444444] text-[11px] font-medium">
              {filtered.length} payment{filtered.length !== 1 ? "s" : ""} shown
            </span>
            {filtered.length > 0 && (
              <span className="text-white text-[11px] font-bold">
                Total: ₹{filtered.reduce((s, p) => s + p.amount, 0).toLocaleString("en-IN")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── ADD PAYMENT MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowModal(false); resetModal() }}
          />
          <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-6 max-w-[420px] w-full relative z-10 animate-modal shadow-2xl shadow-black/60 max-h-[90vh] overflow-y-auto">
            <h2 className="text-white text-[18px] font-black tracking-tight mb-5">Record Payment</h2>

            {/* Member Search */}
            <div className="mb-5" ref={memberSearchRef}>
              <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Member</label>
              <div className="relative">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value)
                    setSelectedMember(null)
                    setSelectedSummary(null)
                    searchMembers(e.target.value)
                  }}
                  placeholder="Type name or phone..."
                  className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[13px] px-4 py-3 rounded-lg focus:border-[#D11F00] focus:outline-none transition-all placeholder:text-[#333333]"
                />
                {showDropdown && memberResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#1A1A1A] border border-[#242424] rounded-lg overflow-hidden z-20 shadow-xl">
                    {memberResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selectMember(m)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#242424] transition-colors text-left cursor-pointer"
                      >
                        <div className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-[#2A2A2A] border border-[#333333]">
                          <span className="text-white text-[11px] font-bold">{m.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-white text-[13px] font-medium leading-tight">{m.name}</p>
                          <p className="text-[#444444] text-[11px]">{m.phone}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Remaining Balance Banner */}
            {selectedMember && (
              summaryLoading ? (
                <div className="bg-[#0F0F0F] border border-[#1C1C1C] rounded-lg px-4 py-3 mb-5 h-12 animate-pulse" />
              ) : selectedSummary ? (
                <div className="bg-[#0F0F0F] border border-[#1C1C1C] rounded-lg px-4 py-3 mb-5 flex justify-between items-start gap-4">
                  <div className="flex flex-col">
                    <span className="text-[#444444] text-[12px]">Global Remaining</span>
                    {typeof selectedSummary.currentPlanRemaining === "number" && selectedSummary.currentPlanAmount > 0 && (
                      <span className="text-[#333333] text-[11px] mt-0.5">
                        Current plan remaining: ₹{Math.max(0, Math.round(selectedSummary.currentPlanRemaining)).toLocaleString("en-IN")}
                      </span>
                    )}
                  </div>
                  {selectedSummary.remaining > 0 ? (
                    <span className="text-[#D11F00] text-[16px] font-black">₹{selectedSummary.remaining.toLocaleString("en-IN")}</span>
                  ) : selectedSummary.remaining === 0 ? (
                    <span className="text-[#10B981] text-[14px] font-bold">Fully Paid ✓</span>
                  ) : (
                    <span className="text-[#F59E0B] text-[14px] font-bold">Overpaid by ₹{Math.abs(selectedSummary.remaining).toLocaleString("en-IN")}</span>
                  )}
                </div>
              ) : null
            )}

            {selectedMember && selectedSummary && dueAmount <= 0 && (
              <div className="bg-[#10B981]/10 border border-[#10B981]/20 rounded-lg px-4 py-3 mb-5">
                <p className="text-[#10B981] text-[12px] font-medium">
                  No due amount pending. You can&apos;t record a payment above ₹0.
                </p>
              </div>
            )}
            {selectedMember && selectedSummary && overDue && (
              <div className="bg-[#D11F00]/10 border border-[#D11F00]/20 rounded-lg px-4 py-3 mb-5">
                <p className="text-[#D11F00] text-[12px] font-medium">
                  Amount cannot exceed due amount (₹{dueAmount.toLocaleString("en-IN")}).
                </p>
              </div>
            )}

            <div className="space-y-4">
              {/* Amount */}
              <div>
                <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Amount</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555555] text-[14px] font-medium">₹</span>
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, Math.round(Number(selectedSummary?.remaining ?? 0)))}
                    value={modalAmount}
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = raw === "" ? 0 : Number(raw)
                      const next = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
                      const clamped = dueAmount > 0 ? Math.min(next, dueAmount) : 0
                      setModalAmount(String(clamped))
                    }}
                    onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault()
                    }}
                    placeholder="0"
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[14px] rounded-lg pl-9 pr-4 py-3 focus:border-[#D11F00] focus:ring-1 focus:ring-[#D11F00]/20 focus:outline-none transition-all font-bold"
                  />
                </div>
                {/* Quick fill */}
                {selectedSummary && selectedSummary.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => setModalAmount(String(selectedSummary.remaining))}
                    className="text-[#D11F00] text-[11px] mt-1.5 underline underline-offset-2 hover:text-[#FF3A1A] transition-colors cursor-pointer"
                  >
                    Pay remaining ₹{selectedSummary.remaining.toLocaleString("en-IN")}
                  </button>
                )}
                {/* Live total */}
                {selectedSummary && enteredAmt > 0 && (
                  afterRemaining <= 0 && afterRemaining > -1 ? (
                    <p className="text-[#10B981] text-[11px] mt-1">After this: Fully paid ✓</p>
                  ) : afterRemaining < -1 ? (
                    <p className="text-[#F59E0B] text-[11px] mt-1">After this: Overpaid by ₹{Math.abs(afterRemaining).toLocaleString("en-IN")}</p>
                  ) : (
                    <p className="text-[#444444] text-[11px] mt-1">After this: ₹{afterRemaining.toLocaleString("en-IN")} remaining</p>
                  )
                )}
              </div>

              {/* Date + Mode */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Date</label>
                  <input
                    type="date"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[13px] px-3 py-3 rounded-lg focus:border-[#D11F00] focus:outline-none transition-all [color-scheme:dark] cursor-pointer"
                  />
                </div>
                <div>
                  <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase block mb-1.5">Mode</label>
                  <select
                    value={modalMode}
                    onChange={(e) => setModalMode(e.target.value as "CASH" | "UPI" | "CARD")}
                    className="w-full bg-[#0F0F0F] border border-[#242424] text-white text-[13px] px-3 py-3 rounded-lg focus:border-[#D11F00] focus:outline-none transition-all cursor-pointer appearance-none"
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
              </div>

              {/* Error */}
              {modalError && (
                <p className="text-[#D11F00] text-[11px] font-medium">{modalError}</p>
              )}

              {/* Buttons */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetModal() }}
                  className="flex-1 bg-transparent border border-[#242424] text-[#444444] hover:text-white hover:border-[#444444] font-bold text-[12px] tracking-[0.1em] uppercase py-3 rounded-lg transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || saveSuccess || dueAmount <= 0 || overDue}
                  className={`themeFancyBtn flex-[2] py-3 flex items-center justify-center gap-2 ${saveSuccess ? "themeFancyBtn--success" : saving ? "themeFancyBtn--loading" : modalError ? "themeFancyBtn--error" : ""} ${saving ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  {saveSuccess ? (
                    <span className="flex items-center gap-2">Recorded ✓</span>
                  ) : saving ? (
                    <span className="flex items-center">
                      <span className="themeBtnMiniLoader"><span /><span /><span /></span>
                      <span>Saving...</span>
                    </span>
                  ) : (
                    "Save Payment"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
