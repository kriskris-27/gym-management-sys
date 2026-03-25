"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMembers } from "@/hooks/useMembers"

interface Member {
  id: string
  name: string
  phone: string
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"
  startDate: string
  endDate: string
  status: "ACTIVE" | "INACTIVE" | "DELETED"
  isPaidFull: boolean
  totalAmount: number
  totalPaid: number
  remaining: number
}

export default function MembersPage() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [planFilter, setPlanFilter] = useState("All Plans")
  const [paymentFilter, setPaymentFilter] = useState("All Payments")
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const statusMap: Record<string, string | undefined> = {
    "All": undefined,
    "Active": "ACTIVE",
    "Expired": "ACTIVE", // Expired members are still ACTIVE status but with endDate < now
    "Deleted": "DELETED"
  }
  
  const { data: rawData, isLoading: loading, refetch } = useMembers(undefined, statusMap[statusFilter])
  const members: Member[] = rawData?.members ?? []


  const now = new Date()
  
  // Date Helpers
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const datePart = dateStr.split("T")[0];
    const [year, month, day] = datePart.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
  }
  
  const getDaysDiff = (endDateStr: string) => {
    const end = new Date(endDateStr)
    const diff = end.getTime() - now.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  const formatPlan = (plan: string) => {
    switch (plan) {
      case "MONTHLY": return "Monthly"
      case "QUARTERLY": return "Quarterly"
      case "HALF_YEARLY": return "Half Yearly"
      case "ANNUAL": return "Annual"
      case "PERSONAL_TRAINING": return "Personal"
      default: return plan
    }
  }

  const planMap: Record<string, string> = {
    "Monthly":     "MONTHLY",
    "Quarterly":   "QUARTERLY",
    "Half-Yearly": "HALF_YEARLY",
    "Annual":      "ANNUAL",
    "Personal":    "PERSONAL_TRAINING",
  }

  const planCounts = members.reduce((acc, m) => {
    acc[m.membershipType] = (acc[m.membershipType] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Use filtered list but without payment filter applied
  // so counts show how many in current view are paid/unpaid
  const filteredWithoutPayment = members.filter(m => {
    const isExpired = new Date(m.endDate) < now

    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search)

    // For "Expired" filter, still need to filter frontend since API doesn't know about dates
    const matchesStatus =
      statusFilter === "Expired" ? isExpired && m.status === "ACTIVE" :
      statusFilter === "Active" ? !isExpired && m.status === "ACTIVE" :
      true // API already handles "All" and "Deleted" filters

    const matchesPlan =
      planFilter === "All Plans" ? true :
      m.membershipType === planMap[planFilter]

    return matchesSearch && matchesStatus && matchesPlan
  })

  const paidCount = filteredWithoutPayment.filter(
    m => m.isPaidFull
  ).length
  const unpaidCount = filteredWithoutPayment.filter(
    m => !m.isPaidFull && m.remaining > 0
  ).length

  const filtered = filteredWithoutPayment.filter(m => {
    // Payment filter
    const matchesPayment =
      paymentFilter === "All Payments" ? true :
      paymentFilter === "Paid" ? m.isPaidFull :
      paymentFilter === "Unpaid" ? !m.isPaidFull :
      true

    return matchesPayment
  })

  const handleRestore = async (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRestoringId(memberId)
    try {
      const res = await fetch(`/api/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" })
      })
      if (res.ok) {
        refetch()
      }
    } catch (error) {
      console.error(error)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="w-full min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30 overflow-x-hidden">
      <style>{`
        @keyframes fadeUp {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-fadeUp { animation: fadeUp 0.4s ease-out forwards; }
      `}</style>
      
      {/* TOP ROW: Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-white text-[28px] font-black tracking-tight">Members</h1>
          <p className="text-[#444444] text-[13px]">{members.length} registered</p>
        </div>
        <button
          onClick={() => router.push("/admin/members/new")}
          className="bg-[#D11F00] hover:bg-[#B51A00] text-white font-bold text-[12px] tracking-[0.1em] uppercase px-5 py-2.5 rounded-lg transition-all duration-200 active:scale-[0.98] self-start sm:self-auto cursor-pointer"
        >
          + Add Member
        </button>
      </div>

      {/* FILTER ROW */}
      <div className="mt-8 flex flex-col md:flex-row gap-4 items-start md:items-center">
        {/* Search Input */}
        <div className="relative w-full md:max-w-[320px] flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#333333]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full bg-[#111111] border border-[#1C1C1C] text-white text-[13px] pl-10 pr-4 py-2.5 rounded-lg placeholder:text-[#333333] focus:border-[#D11F00] focus:outline-none transition-colors duration-200"
          />
        </div>

        {/* Status Filter Tabs */}
        <div className="flex bg-[#111111] border border-[#1C1C1C] rounded-lg p-1 overflow-x-auto max-w-full">
          {["All", "Active", "Expired", "Deleted"].map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`
                px-4 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200 whitespace-nowrap cursor-pointer
                ${statusFilter === tab 
                  ? "bg-[#1C1C1C] text-white border border-[#2A2A2A] shadow-sm shadow-black/20" 
                  : "bg-transparent text-[#444444] border border-transparent hover:text-[#888888]"}
              `}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* PAYMENT FILTER ROW */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {["All Payments", "Paid", "Unpaid"].map(tab => {
          const isActive = paymentFilter === tab
          const count = 
            tab === "Paid" ? paidCount :
            tab === "Unpaid" ? unpaidCount :
            null
          return (
            <button
              key={tab}
              onClick={() => setPaymentFilter(tab)}
              className={`
                px-4 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer border
                ${isActive
                  ? "bg-[#1C1C1C] text-white border-[#2A2A2A]"
                  : "bg-[#111111] text-[#444444] border-[#1C1C1C] hover:text-[#888888]"}
              `}
            >
              {tab}
              {count !== null && count > 0 && (
                <span className={`ml-1.5 text-[10px] ${isActive ? "text-[#888888]" : "text-[#444444]"}`}>
                  ({count})
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* PLAN FILTER ROW */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {["All Plans", "Monthly", "Quarterly", "Half-Yearly", "Annual", "Personal"].map(tab => {
          const isActive = planFilter === tab
          const enumKey = planMap[tab]
          const count = enumKey ? planCounts[enumKey] ?? 0 : null
          return (
            <button
              key={tab}
              onClick={() => setPlanFilter(tab)}
              className={`
                px-4 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 cursor-pointer border
                ${isActive
                  ? "bg-[#1C1C1C] text-white border-[#2A2A2A]"
                  : "bg-[#111111] text-[#444444] border-[#1C1C1C] hover:text-[#888888]"}
              `}
            >
              {tab}
              {count !== null && count > 0 && (
                <span className={`ml-1.5 text-[10px] ${isActive ? "text-[#888888]" : "text-[#444444]"}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* MEMBERS TABLE */}
      <div className="mt-6 bg-[#111111] border border-[#1C1C1C] rounded-xl overflow-hidden animate-fadeUp opacity-0 border-collapse">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left min-w-[750px]">
            <thead className="bg-[#0D0D0D] border-b border-[#1C1C1C]">
              <tr>
                <th className="w-[40%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Member</th>
                <th className="w-[15%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Plan</th>
                <th className="w-[12%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Start</th>
                <th className="w-[12%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Expires</th>
                <th className="w-[11%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Status</th>
                <th className="w-[10%] text-[#333333] text-[10px] tracking-widest uppercase px-5 py-4 font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                /* LOADING SKELETON */
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#0D0D0D]">
                    <td colSpan={6} className="px-5 py-3">
                      <div className="bg-[#1C1C1C] animate-pulse h-[40px] rounded" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                /* EMPTY STATE */
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <p className="text-[#333333] text-[14px] font-medium">No members found</p>
                    <p className="text-[#2A2A2A] text-[12px] mt-1">Try adjusting your search or filters</p>
                  </td>
                </tr>
              ) : (
                /* DATA ROWS */
                filtered.map(member => {
                  const isExpired = new Date(member.endDate) < now
                  const daysLeft = getDaysDiff(member.endDate)
                  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 7
                  const initial = member.name.charAt(0).toUpperCase()
                  const remaining = member.remaining

                  // Membership status badge
                  const membershipBadge = isExpired ? (
                    <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">
                      Expired
                    </span>
                  ) : (
                    <span className="inline-block bg-[#10B981]/10 text-[#10B981] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#10B981]/20">
                      Active
                    </span>
                  )

                  // Payment status badge
                  const paymentBadge = member.isPaidFull ? (
                    <span className="inline-block bg-[#10B981]/10 text-[#10B981] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#10B981]/20">
                      Paid
                    </span>
                  ) : remaining === 0 ? (
                    <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#2A2A2A]">
                      Free
                    </span>
                  ) : (
                    <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">
                      ₹{remaining.toLocaleString('en-IN')} due
                    </span>
                  )

                  const statusBadge = (
                    <div className="flex gap-1.5 flex-wrap">
                      {membershipBadge}
                      {paymentBadge}
                    </div>
                  )

                  // Plan badge logic
                  const isPremiumPlan = member.membershipType === "ANNUAL"
                  const planBadgeClass = isPremiumPlan 
                    ? "bg-[#D11F00]/10 text-[#D11F00] border border-[#D11F00]/20" 
                    : "bg-[#1C1C1C] text-[#888888] border border-[#242424]"

                  // Expiry color logic
                  const expiresColorClass = isExpired 
                    ? "text-[#D11F00]" 
                    : isExpiringSoon ? "text-[#FF6B00]" : "text-[#666666]"

                  return (
                    <tr 
                      key={member.id}
                      onClick={() => router.push(`/admin/members/${member.id}`)}
                      className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] cursor-pointer transition-colors duration-150 group"
                    >
                      {/* MEMBER COLUMN */}
                      <td className="px-5 py-4">
                        <div className="flex flex-row items-center gap-3">
                          <div className={`
                            w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-[#1C1C1C]
                            ${isExpiringSoon && !isExpired ? "border-2 border-[#D11F00]" : "border border-[#242424]"}
                          `}>
                            <span className="text-white text-[13px] font-bold">{initial}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-white text-[13px] font-medium leading-tight group-hover:text-[#D11F00] transition-colors">{member.name}</span>
                            <span className="text-[#444444] text-[11px] mt-0.5">{member.phone}</span>
                          </div>
                        </div>
                      </td>

                      {/* PLAN COLUMN */}
                      <td className="px-5 py-4">
                        <span className={`inline-block text-[11px] px-2.5 py-1 rounded-md font-medium ${planBadgeClass}`}>
                          {formatPlan(member.membershipType)}
                        </span>
                      </td>

                      {/* START DATE */}
                      <td className="px-5 py-4">
                        <span className="text-[#666666] text-[12px]">
                          {formatDate(member.startDate)}
                        </span>
                      </td>

                      {/* EXPIRES DATE */}
                      <td className="px-5 py-4">
                        <span className={`text-[12px] font-medium ${expiresColorClass}`}>
                          {formatDate(member.endDate)}
                        </span>
                      </td>

                      {/* STATUS */}
                      <td className="px-5 py-4">
                        {statusBadge}
                      </td>

                      {/* ACTION */}
                      <td className="px-5 py-4">
                        {member.status === "DELETED" ? (
                          <button
                            onClick={(e) => handleRestore(member.id, e)}
                            disabled={restoringId === member.id}
                            className="text-[#D11F00] hover:text-[#FF6B00] text-[12px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                          >
                            {restoringId === member.id ? (
                              <>
                                <svg className="w-3 h-3 animate-spin" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/></svg>
                                Restoring...
                              </>
                            ) : (
                              <>
                                Restore
                                <svg className="w-3 h-3 hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[#444444] hover:text-[#D11F00] text-[12px] font-medium group-hover:text-[#D11F00] transition-colors flex items-center gap-1 cursor-pointer">
                            View
                            <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
