"use client"

import React, { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useQueries } from "@tanstack/react-query"
import { useAttendanceToday } from "@/hooks/useAttendance"

interface PaymentSummary {
  dueAmount: number
  totalPaid: number
  remaining: number
  isPaidFull: boolean
}

interface AttendanceRecord {
  memberId: string
  memberName: string
  memberPhone: string
  checkedInAt: string
  checkedOutAt: string | null
  durationMinutes: number | null
  autoClosed: boolean
  isExpired: boolean
}

interface AttendanceData {
  date: string
  totalPresent: number
  records: AttendanceRecord[]
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}hr`
  return `${h}hr ${m}min`
}

function getTodayLabel(): string {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const ist = new Date(now.getTime() + istOffset)
  return ist.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export default function AttendancePage() {
  const router = useRouter()
  const { data: rawData, isLoading: loading } = useAttendanceToday()
  const data = rawData as AttendanceData | undefined
  const [filter, setFilter] = useState("All")
  const [now, setNow] = useState(new Date())

  const memberIds = useMemo(
    () => [...new Set(data?.records.map((r) => r.memberId) ?? [])],
    [data?.records]
  )

  const summaryQueries = useQueries({
    queries: memberIds.map((id) => ({
      queryKey: ["payments", "summary", id],
      queryFn: async (): Promise<PaymentSummary> => {
        const res = await fetch(`/api/payments/summary/${id}`)
        if (!res.ok) throw new Error("Failed")
        return res.json()
      },
      staleTime: 30 * 1000,
      enabled: memberIds.length > 0 && !loading,
    })),
  })

  const summaryByMemberId = useMemo(() => {
    return Object.fromEntries(
      memberIds.map((id, i) => [
        id,
        {
          data: summaryQueries[i]?.data ?? null,
          isPending: summaryQueries[i]?.isPending ?? false,
          isError: summaryQueries[i]?.isError ?? false,
        },
      ])
    ) as Record<
      string,
      {
        data: PaymentSummary | null
        isPending: boolean
        isError: boolean
      }
    >
  }, [memberIds, summaryQueries])

  // Tick now every 60s for live durations
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])


  const getLiveDuration = (checkedInAt: string): string => {
    const start = new Date(checkedInAt)
    const mins = Math.floor((now.getTime() - start.getTime()) / 60000)
    const hrs = Math.floor(mins / 60)
    const rem = mins % 60
    if (hrs === 0) return `${rem}min`
    if (rem === 0) return `${hrs}hr`
    return `${hrs}hr ${rem}min`
  }

  const filtered = (data?.records ?? []).filter((r) => {
    if (filter === "All") return true
    if (filter === "Inside") return !r.checkedOutAt && !r.autoClosed
    if (filter === "Completed") return r.checkedOutAt && !r.autoClosed
    if (filter === "Auto-closed") return r.autoClosed
    return true
  })

  const completedSessions = (data?.records ?? []).filter(
    (r) => r.durationMinutes !== null && r.checkedOutAt
  )
  const avgDuration =
    completedSessions.length > 0
      ? Math.floor(
          completedSessions.reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0) /
            completedSessions.length
        )
      : null

  const currentlyInside = (data?.records ?? []).filter(
    (r) => !r.checkedOutAt && !r.autoClosed
  ).length

  return (
    <div className="min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30">
      <style>{`
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .animate-page { animation: fadeIn 0.4s ease-out forwards; }
        .animate-tab { animation: fadeIn 0.2s ease-out forwards; }
        .dot-pulse { animation: pulse-dot 1.5s ease-in-out infinite; }
      `}</style>

      {/* TOP ROW */}
      <div className="flex items-start justify-between animate-page">
        <div>
          <h1 className="text-white text-[28px] font-black tracking-tight">Attendance</h1>
          <p className="text-[#444444] text-[13px] mt-1">{getTodayLabel()}</p>
        </div>
        <div className="flex items-center gap-2 bg-[#D11F00]/10 text-[#D11F00] text-[10px] font-bold tracking-[0.15em] uppercase px-3 py-1.5 rounded-full border border-[#D11F00]/20">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D11F00] dot-pulse inline-block" />
          Live
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-3 gap-4 mt-6 animate-page">
        {/* Total Present */}
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-5">
          <p className="text-[#444444] text-[10px] tracking-widest uppercase font-bold mb-3">
            Total Present
          </p>
          {loading ? (
            <div className="bg-[#1C1C1C] h-10 w-20 rounded animate-pulse mb-2" />
          ) : (
            <p className="text-white text-[36px] font-black leading-none">
              {data?.totalPresent ?? 0}
            </p>
          )}
          <p className="text-[#333333] text-[11px] mt-2">members today</p>
        </div>

        {/* Inside Now */}
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-5">
          <p className="text-[#444444] text-[10px] tracking-widest uppercase font-bold mb-3 flex items-center gap-2">
            Inside Now
            {!loading && currentlyInside > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#D11F00] dot-pulse inline-block" />
            )}
          </p>
          {loading ? (
            <div className="bg-[#1C1C1C] h-10 w-20 rounded animate-pulse mb-2" />
          ) : (
            <p
              className={`text-[36px] font-black leading-none ${
                currentlyInside > 0 ? "text-[#D11F00]" : "text-white"
              }`}
            >
              {currentlyInside}
            </p>
          )}
          <p className="text-[#333333] text-[11px] mt-2">currently training</p>
        </div>

        {/* Avg Duration */}
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-5">
          <p className="text-[#444444] text-[10px] tracking-widest uppercase font-bold mb-3">
            Avg Duration
          </p>
          {loading ? (
            <div className="bg-[#1C1C1C] h-10 w-24 rounded animate-pulse mb-2" />
          ) : (
            <p className="text-white text-[36px] font-black leading-none">
              {avgDuration !== null ? formatDuration(avgDuration) : "—"}
            </p>
          )}
          <p className="text-[#333333] text-[11px] mt-2">per session today</p>
        </div>
      </div>

      {/* ATTENDANCE TABLE */}
      <div className="mt-6 bg-[#111111] border border-[#1C1C1C] rounded-xl overflow-hidden animate-page">
        {/* Table Header Row */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1C1C1C]">
          <h2 className="text-white font-bold text-[14px]">Today's Sessions</h2>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5">
            {["All", "Inside", "Completed", "Auto-closed"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 cursor-pointer border
                  ${
                    filter === tab
                      ? "bg-[#1C1C1C] text-white border-[#2A2A2A]"
                      : "bg-transparent text-[#444444] border-transparent hover:text-[#888888]"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px]">
            <thead className="border-b border-[#1C1C1C] bg-[#0D0D0D]">
              <tr>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Member</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Check In</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Check Out</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Duration</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Status</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Payment</th>
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
                    <p className="text-[#333333] text-[14px] font-medium">No check-ins today</p>
                    <p className="text-[#2A2A2A] text-[12px] mt-1">
                      Members will appear here as they check in
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((record, idx) => {
                  const isOngoing = !record.checkedOutAt && !record.autoClosed
                  const initial = record.memberName.charAt(0).toUpperCase()

                  let durationDisplay: React.ReactNode
                  if (isOngoing) {
                    durationDisplay = (
                      <span className="text-[#D11F00] text-[12px] font-medium">
                        {getLiveDuration(record.checkedInAt)} ongoing
                      </span>
                    )
                  } else if (record.autoClosed) {
                    durationDisplay = (
                      <span className="text-[#444444] text-[12px] italic">
                        {record.durationMinutes !== null
                          ? `${formatDuration(record.durationMinutes)} *`
                          : "— *"}
                      </span>
                    )
                  } else {
                    durationDisplay = (
                      <span className="text-[#888888] text-[12px]">
                        {record.durationMinutes !== null
                          ? formatDuration(record.durationMinutes)
                          : "—"}
                      </span>
                    )
                  }

                  let statusBadge: React.ReactNode
                  if (isOngoing) {
                    statusBadge = (
                      <span className="inline-flex items-center gap-1.5 bg-[#D11F00]/10 text-[#D11F00] border border-[#D11F00]/20 text-[10px] font-bold px-2.5 py-1 rounded-md tracking-wide uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#D11F00] dot-pulse" />
                        Inside
                      </span>
                    )
                  } else if (record.autoClosed) {
                    statusBadge = (
                      <span className="inline-block bg-[#1C1C1C] text-[#444444] border border-[#242424] text-[10px] px-2.5 py-1 rounded-md font-medium italic">
                        Auto-closed
                      </span>
                    )
                  } else {
                    statusBadge = (
                      <span className="inline-block bg-[#1C1C1C] text-[#555555] border border-[#242424] text-[10px] px-2.5 py-1 rounded-md font-medium">
                        Done
                      </span>
                    )
                  }

                  const pay = summaryByMemberId[record.memberId]
                  let paymentCell: React.ReactNode
                  if (!pay) {
                    paymentCell = (
                      <span className="text-[#333333] text-[12px]">—</span>
                    )
                  } else if (pay.isPending) {
                    paymentCell = (
                      <div className="h-5 w-20 animate-pulse rounded bg-[#1C1C1C]" />
                    )
                  } else if (pay.isError || !pay.data) {
                    paymentCell = (
                      <span className="text-[#333333] text-[12px]">—</span>
                    )
                  } else if (pay.data.dueAmount === 0) {
                    paymentCell = (
                      <span className="inline-block rounded-md bg-[#1C1C1C] px-2.5 py-1 text-[11px] text-[#555555]">
                        Free
                      </span>
                    )
                  } else if (pay.data.isPaidFull) {
                    paymentCell = (
                      <span className="inline-block rounded-md bg-[#10B981]/10 px-2.5 py-1 text-[11px] font-medium text-[#10B981]">
                        Paid ✓
                      </span>
                    )
                  } else {
                    paymentCell = (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(
                            `/admin/members/${record.memberId}#payments`
                          )
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            e.stopPropagation()
                            router.push(
                              `/admin/members/${record.memberId}#payments`
                            )
                          }
                        }}
                        className="inline-block cursor-pointer rounded-md bg-[#D11F00]/10 px-2.5 py-1 text-[11px] font-medium text-[#D11F00] hover:opacity-80"
                      >
                        ₹{pay.data.remaining.toLocaleString("en-IN")} due
                      </span>
                    )
                  }

                  return (
                    <tr
                      key={`${record.memberId}-${idx}`}
                      className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors duration-150 cursor-pointer group"
                      onClick={() => router.push(`/admin/members/${record.memberId}`)}
                    >
                      {/* Member */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-[#1C1C1C] border ${isOngoing ? "border-[#D11F00]/40" : "border-[#242424]"}`}>
                            <span className="text-white text-[12px] font-bold">{initial}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-white text-[13px] font-medium leading-tight group-hover:text-[#D11F00] transition-colors">
                              {record.memberName}
                            </span>
                            <span className="text-[#444444] text-[11px] mt-0.5">{record.memberPhone}</span>
                          </div>
                        </div>
                      </td>

                      {/* Check In */}
                      <td className="px-5 py-4">
                        <span className="text-[#666666] text-[12px]">
                          {formatTime(record.checkedInAt)}
                        </span>
                      </td>

                      {/* Check Out */}
                      <td className="px-5 py-4">
                        {record.checkedOutAt ? (
                          <span className="text-[#666666] text-[12px]">
                            {formatTime(record.checkedOutAt)}
                          </span>
                        ) : (
                          <span className="text-[#333333] text-[12px]">—</span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-5 py-4">{durationDisplay}</td>

                      {/* Status */}
                      <td className="px-5 py-4">{statusBadge}</td>

                      {/* Payment */}
                      <td className="px-5 py-4">{paymentCell}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer count */}
        {!loading && data && (
          <div className="border-t border-[#1C1C1C] px-5 py-3 flex items-center justify-between bg-[#0A0A0A]">
            <span className="text-[#444444] text-[11px] font-medium">
              {filtered.length} session{filtered.length !== 1 ? "s" : ""}{" "}
              {filter !== "All" ? `· ${filter}` : "· today"}
            </span>
            <span className="text-[#2A2A2A] text-[10px]">
              Auto-refreshes every 30s
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
