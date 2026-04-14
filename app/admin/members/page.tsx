"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useMembers } from "@/hooks/useMembers"
import { useRestoreMember } from "@/hooks/useRestoreMember"
import SpeedLoader from "@/app/components/SpeedLoader"
import { adminPageLoadingClass, adminPageShellClass } from "@/app/components/admin-page-shell"
import { formatMemberDate, getMembershipDayInfo, isMembershipEndPast } from "@/lib/gym-datetime"

interface Member {
  id: string
  name: string
  phone: string
  status: "ACTIVE" | "INACTIVE" | "DELETED"
  isPaidFull: boolean
  totalAmount: number
  totalPaid: number
  remaining: number
  subscriptions?: Array<{
    startDate: string
    endDate: string
    status: string
    planNameSnapshot: string
    planPriceSnapshot?: number
  }>
}

export default function MembersPage() {
  const router = useRouter()
  const restoreMemberMutation = useRestoreMember()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState("All")
  const [planFilter, setPlanFilter] = useState("All Plans")
  const [paymentFilter, setPaymentFilter] = useState("All Payments")

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const statusMap: Record<string, string | undefined> = {
    "All": undefined,
    "Active": "ACTIVE",
    "Inactive": "INACTIVE",
    "Deleted": "DELETED"
  }

  const { data: rawData, isLoading: loading } = useMembers({
    search: debouncedSearch || undefined,
    status: statusMap[statusFilter],
    page,
    limit: 50,
  })
  const members: Member[] = (rawData?.members ?? []) as Member[]
  const total = rawData?.total ?? 0
  const totalPages = rawData?.totalPages ?? 1

  if (loading) {
    return (
      <div className={adminPageLoadingClass}>
        <SpeedLoader />
        <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading members</p>
      </div>
    )
  }


  // Date Helpers
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-"
    return formatMemberDate(dateStr)
  }

  const formatPlan = (plan: string) => {
    switch (plan) {
      case "MONTHLY": return "Monthly"
      case "QUARTERLY": return "Quarterly"
      case "HALF_YEARLY": return "Half Yearly"
      case "ANNUAL": return "Annual"
      case "OTHERS": return "Others"
      default: return plan
    }
  }

  const planMap: Record<string, string> = {
    "Monthly": "MONTHLY",
    "Quarterly": "QUARTERLY",
    "Half-Yearly": "HALF_YEARLY",
    "Annual": "ANNUAL",
    "Others": "OTHERS",
  }

  const planCounts = members.reduce((acc, m) => {
    const pName = m.subscriptions?.[0]?.planNameSnapshot || "OTHERS"
    const standard = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"]
    const bucket = standard.includes(pName) ? pName : "OTHERS"
    acc[bucket] = (acc[bucket] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Use filtered list but without payment filter applied
  // so counts show how many in current view are paid/unpaid
  const filteredWithoutPayment = members.filter(m => {
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search)

    // Status filtering - API handles the main filtering, frontend just ensures consistency
    const matchesStatus = true // API already handles all status filters correctly

    const matchesPlan =
      planFilter === "All Plans" ? true :
      planFilter === "Others"
        ? !["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"].includes(m.subscriptions?.[0]?.planNameSnapshot || "")
        : m.subscriptions?.[0]?.planNameSnapshot === planMap[planFilter]

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
    try {
      await restoreMemberMutation.mutateAsync(memberId)
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className={adminPageShellClass}>
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
          <p className="text-[#444444] text-[13px]">
            {total} registered
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>
        </div>
        <button
          onClick={() => router.push("/admin/members/new")}
          className="themeFancyBtn px-5 py-2.5 self-start sm:self-auto cursor-pointer"
        >
          <span>+ Add Member</span>
        </button>
      </div>

      {/* FILTER ROW */}
      <div className="mt-8 flex flex-col md:flex-row gap-4 items-start md:items-center">
        {/* Search Input */}
        <div className="relative w-full md:max-w-[320px] flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#333333]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
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
          {["All", "Active", "Inactive", "Deleted"].map(tab => (
            <button
              key={tab}
              onClick={() => {
                setStatusFilter(tab)
                setPage(1)
              }}
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

      {/* PLAN FILTER ROW — counts are for the current page only */}
      <div className="mt-3 flex gap-2 flex-wrap">
        {["All Plans", "Monthly", "Quarterly", "Half-Yearly", "Annual", "Others"].map(tab => {
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
                  // Get subscription info from the latest subscription
                  const latestSubscription = member.subscriptions?.[0]
                  const isExpired = latestSubscription
                    ? isMembershipEndPast(latestSubscription.endDate)
                    : false
                  const daysLeft = latestSubscription
                    ? getMembershipDayInfo(latestSubscription.endDate).daysUntilEndInclusive
                    : 0
                  const isExpiringSoon = daysLeft >= 0 && daysLeft <= 7
                  const initial = member.name.charAt(0).toUpperCase()
                  const planPrice = latestSubscription?.planPriceSnapshot || 0

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
                  ) : member.remaining > 0 ? (
                    <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">
                      ₹{member.remaining.toLocaleString('en-IN')} due
                    </span>
                  ) : planPrice === 0 ? (
                    <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#2A2A2A]">
                      Free
                    </span>
                  ) : (
                    <span className="inline-block bg-[#444444]/10 text-[#888888] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#444444]/20">
                      Pending
                    </span>
                  )

                  const statusBadge = (
                    <div className="flex gap-1.5 flex-wrap">
                      {membershipBadge}
                      {paymentBadge}
                    </div>
                  )

                  // Plan badge logic
                  const isPremiumPlan =
                    latestSubscription?.planNameSnapshot === "ANNUAL"
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
                          {formatPlan(latestSubscription?.planNameSnapshot || "OTHERS")}
                        </span>
                      </td>

                      {/* START DATE */}
                      <td className="px-5 py-4">
                        <span className="text-[#666666] text-[12px]">
                          {formatDate(latestSubscription?.startDate || "")}
                        </span>
                      </td>

                      {/* EXPIRES DATE */}
                      <td className="px-5 py-4">
                        <span className={`text-[12px] font-medium ${expiresColorClass}`}>
                          {formatDate(latestSubscription?.endDate || "")}
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
                            disabled={restoreMemberMutation.isPending}
                            className="text-[#D11F00] hover:text-[#FF6B00] text-[12px] font-medium transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                          >
                            {restoreMemberMutation.isPending && restoreMemberMutation.variables === member.id ? (
                              <>
                                <svg className="w-3 h-3 animate-spin" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" /></svg>
                                Restoring...
                              </>
                            ) : (
                              <>
                                Restore
                                <svg className="w-3 h-3 hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-[#444444] hover:text-[#D11F00] text-[12px] font-medium group-hover:text-[#D11F00] transition-colors flex items-center gap-1 cursor-pointer">
                            View
                            <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
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

      {totalPages > 1 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[13px] text-[#888888]">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 rounded-lg border border-[#1C1C1C] bg-[#111111] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#2A2A2A] cursor-pointer"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-2 rounded-lg border border-[#1C1C1C] bg-[#111111] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#2A2A2A] cursor-pointer"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
