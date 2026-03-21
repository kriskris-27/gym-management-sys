"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

interface Member {
  id: string
  name: string
  phone: string
  membershipType: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "PERSONAL_TRAINING"
  startDate: string
  endDate: string
  status: "ACTIVE" | "INACTIVE" | "DELETED"
}

export default function MembersPage() {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/members")
      .then(res => res.json())
      .then(data => {
        setMembers(data.members || [])
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const now = new Date()
  
  // Date Helpers
  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    })
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

  const filtered = members.filter(m => {
    const isExpired = new Date(m.endDate) < now

    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search)

    const matchesStatus =
      statusFilter === "All" ? true :
      statusFilter === "Active" ? m.status === "ACTIVE" && !isExpired :
      statusFilter === "Inactive" ? m.status === "INACTIVE" :
      statusFilter === "Expired" ? isExpired : true

    return matchesSearch && matchesStatus
  })

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
          {["All", "Active", "Inactive", "Expired"].map(tab => (
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

                  // Status badge logic
                  let statusBadge = null
                  if (isExpired) {
                    statusBadge = (
                      <span className="inline-block bg-[#D11F00]/10 text-[#D11F00] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#D11F00]/20">
                        Expired
                      </span>
                    )
                  } else if (member.status === "ACTIVE") {
                    statusBadge = (
                      <span className="inline-block bg-[#10B981]/10 text-[#10B981] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#10B981]/20">
                        Active
                      </span>
                    )
                  } else {
                    statusBadge = (
                      <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[11px] px-2.5 py-1 rounded-md font-medium border border-[#2A2A2A]">
                        Inactive
                      </span>
                    )
                  }

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
                        <span className="text-[#444444] text-[12px] font-medium group-hover:text-[#D11F00] transition-colors flex items-center gap-1">
                          View
                          <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        </span>
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
