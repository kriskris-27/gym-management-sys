"use client"

import { useState, useEffect, useMemo } from "react"
import { useDashboard } from "@/hooks/useDashboard"
import {
  formatGymClock,
  formatGymDateLong,
  formatGymTime,
  parseGymDateOnly,
  GYM_TIMEZONE,
} from "@/lib/gym-datetime"
import SpeedLoader from "@/app/components/SpeedLoader"

interface Member {
  id: string
  name: string
  phone: string
  endDate: string
  daysLeft: number
}

interface Attendance {
  memberId: string
  memberName: string
  checkedInAt: string
  checkedOutAt: string | null
  durationMinutes: number | null
  durationFormatted?: string
  autoClosed: boolean
}

interface DashboardData {
  today: {
    date: string
    totalPresent: number
    currentlyInside: number
    attendance: Attendance[]
  }
  members: {
    total: number
    active: number
    inactive: number
    expiringSoon: Member[]
  }
  payments: {
    thisMonth: number
    thisMonthCount: number
  }
  notifications: {
    failedCount: number
  }
}

export default function DashboardPage() {
  const { data: rawData, isLoading: loading, refetch } = useDashboard()
  const data = rawData as DashboardData | undefined
  const fetchData = () => {
    refetch()
  }

  const [istClock, setIstClock] = useState(() => formatGymClock())

  useEffect(() => {
    const id = setInterval(() => setIstClock(formatGymClock()), 1000)
    return () => clearInterval(id)
  }, [])

  const headerDateLabel = useMemo(() => {
    if (!data?.today?.date) return "Loading..."
    const d = parseGymDateOnly(data.today.date)
    return d ? formatGymDateLong(d) : data.today.date
  }, [data?.today?.date])

  return (
    <div className="w-full min-h-screen bg-[#080808] p-8 text-white font-sans selection:bg-[#D11F00]/30 overflow-x-hidden">
      <style>{`
        @keyframes fadeUp {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulse-red {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.5; }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-fadeUp { animation: fadeUp 0.5s ease-out forwards; }
        .dot-pulse { animation: pulse-red 1.5s infinite; }
      `}</style>
      
      {/* TOP ROW: Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-white text-[28px] font-black tracking-tight">Dashboard</h1>
          <p className="text-[#444444] text-[13px]">{headerDateLabel}</p>
          <p className="text-[#333333] text-[11px] mt-0.5 font-mono tabular-nums">
            {istClock}{" "}
            <span className="text-[#444444]">({GYM_TIMEZONE})</span>
          </p>
        </div>
        <div className="bg-[#D11F00]/10 text-[#D11F00] text-[10px] font-bold tracking-[0.15em] uppercase px-3 py-1 rounded-full flex items-center gap-2 self-start sm:self-auto border border-[#D11F00]/20">
          <div className="w-1.5 h-1.5 bg-[#D11F00] rounded-full dot-pulse" />
          Live
        </div>
      </div>

      {loading ? (
        // LOADING SKELETONS
        <div className="mt-8 flex flex-col items-center justify-center gap-3">
          <SpeedLoader />
          <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading dashboard</p>
        </div>
      ) : data ? (
        <>
          {/* STAT CARDS ROW */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Card 1 */}
            <div className="themeFxCardOuter animate-fadeUp [animation-delay:0.1s] opacity-0">
              <div className="themeFxCard">
                <div className="themeFxCardRay" />
                <div className="themeFxCardLine themeFxCardLineTop" />
                <div className="themeFxCardLine themeFxCardLineBottom" />
                <div className="themeFxCardLine themeFxCardLineLeft" />
                <div className="themeFxCardLine themeFxCardLineRight" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D11F00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <h3 className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold">Present Today</h3>
                  </div>
                  <div className="text-white text-[40px] font-black leading-none mb-1">{data.today.totalPresent}</div>
                  <p className="text-[#c9c9c9] text-[11px] font-medium uppercase tracking-wider">members checked in</p>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="themeFxCardOuter animate-fadeUp [animation-delay:0.2s] opacity-0">
              <div className="themeFxCard">
                <div className="themeFxCardRay" />
                <div className="themeFxCardLine themeFxCardLineTop" />
                <div className="themeFxCardLine themeFxCardLineBottom" />
                <div className="themeFxCardLine themeFxCardLineLeft" />
                <div className="themeFxCardLine themeFxCardLineRight" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={data.today.currentlyInside > 0 ? "#D11F00" : "#555555"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <h3 className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold">Inside Now</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-white text-[40px] font-black leading-none mb-1">{data.today.currentlyInside}</div>
                    {data.today.currentlyInside > 0 && (
                      <div className="w-1.5 h-1.5 bg-[#D11F00] rounded-full dot-pulse -mt-2" />
                    )}
                  </div>
                  <p className="text-[#c9c9c9] text-[11px] font-medium uppercase tracking-wider">currently training</p>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="themeFxCardOuter animate-fadeUp [animation-delay:0.3s] opacity-0">
              <div className="themeFxCard">
                <div className="themeFxCardRay" />
                <div className="themeFxCardLine themeFxCardLineTop" />
                <div className="themeFxCardLine themeFxCardLineBottom" />
                <div className="themeFxCardLine themeFxCardLineLeft" />
                <div className="themeFxCardLine themeFxCardLineRight" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <h3 className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold">Active Members</h3>
                  </div>
                  <div className="text-white text-[40px] font-black leading-none mb-1">{data.members.active}</div>
                  <p className="text-[#c9c9c9] text-[11px] font-medium uppercase tracking-wider">{data.members.total} total registered</p>
                </div>
              </div>
            </div>

            {/* Card 4 */}
            <div className="themeFxCardOuter animate-fadeUp [animation-delay:0.4s] opacity-0">
              <div className="themeFxCard">
                <div className="themeFxCardRay" />
                <div className="themeFxCardLine themeFxCardLineTop" />
                <div className="themeFxCardLine themeFxCardLineBottom" />
                <div className="themeFxCardLine themeFxCardLineLeft" />
                <div className="themeFxCardLine themeFxCardLineRight" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    <h3 className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold">This Month</h3>
                  </div>
                  <div className="text-white text-[40px] font-black leading-none mb-1">
                    ₹{data.payments.thisMonth.toLocaleString('en-IN')}
                  </div>
                  <p className="text-[#c9c9c9] text-[11px] font-medium uppercase tracking-wider">{data.payments.thisMonthCount} transactions</p>
                </div>
              </div>
            </div>
          </div>

          {/* MIDDLE ROW: Left Table + Right List */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            
            {/* LEFT: Today's Attendance Table */}
            <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 animate-fadeUp [animation-delay:0.5s] opacity-0 flex flex-col h-full min-h-[400px]">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-white font-bold text-[15px]">Today&apos;s Attendance</h2>
                <button 
                  onClick={fetchData}
                  className="text-[#444444] hover:text-[#D11F00] transition-colors flex items-center justify-center p-1 rounded-md"
                  aria-label="Refresh"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                </button>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr>
                      <th className="text-left text-[#333333] text-[10px] tracking-widest uppercase border-b border-[#1C1C1C] pb-3 whitespace-nowrap">Name</th>
                      <th className="text-left text-[#333333] text-[10px] tracking-widest uppercase border-b border-[#1C1C1C] pb-3 whitespace-nowrap">Check In</th>
                      <th className="text-left text-[#333333] text-[10px] tracking-widest uppercase border-b border-[#1C1C1C] pb-3 whitespace-nowrap">Check Out</th>
                      <th className="text-left text-[#333333] text-[10px] tracking-widest uppercase border-b border-[#1C1C1C] pb-3 whitespace-nowrap">Duration</th>
                      <th className="text-right text-[#333333] text-[10px] tracking-widest uppercase border-b border-[#1C1C1C] pb-3 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.today.attendance.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center text-[#333333] text-[13px] py-16 font-medium">
                          No check-ins today
                        </td>
                      </tr>
                    ) : (
                      data.today.attendance.map((record, i) => {
                        const isOngoing = !record.checkedOutAt && !record.autoClosed;
                        return (
                          <tr key={i} className="hover:bg-[#0D0D0D] transition-colors group">
                            <td className="py-3.5 border-b border-[#0D0D0D] text-white text-[13px] font-medium whitespace-nowrap pr-4">
                              {record.memberName}
                            </td>
                            <td className="py-3.5 border-b border-[#0D0D0D] text-[#888888] text-[13px] whitespace-nowrap pr-4">
                              {formatGymTime(record.checkedInAt)}
                            </td>
                            <td className="py-3.5 border-b border-[#0D0D0D] text-[#888888] text-[13px] whitespace-nowrap pr-4">
                              {formatGymTime(record.checkedOutAt)}
                            </td>
                            <td className="py-3.5 border-b border-[#0D0D0D] text-white text-[13px] font-mono pr-4">
                              {!record.checkedOutAt && !record.autoClosed
                                ? "ongoing"
                                : (record.durationFormatted ?? "-")}
                            </td>
                            <td className="py-3.5 border-b border-[#0D0D0D] text-right whitespace-nowrap">
                              {isOngoing ? (
                                <span className="inline-flex items-center gap-1.5 bg-[#D11F00]/10 text-[#D11F00] text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider border border-[#D11F00]/20">
                                  <span className="w-1 h-1 bg-[#D11F00] rounded-full dot-pulse" />
                                  Live
                                </span>
                              ) : record.autoClosed ? (
                                <span className="inline-block bg-[#1C1C1C] text-[#444444] text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider border border-[#242424]">
                                  Auto-closed
                                </span>
                              ) : (
                                <span className="inline-block bg-[#1C1C1C] text-[#555555] text-[10px] font-bold px-2.5 py-1 rounded-sm uppercase tracking-wider border border-[#242424]">
                                  Done
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

            {/* RIGHT: Expiring Soon */}
            <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-5 animate-fadeUp [animation-delay:0.6s] opacity-0 flex flex-col h-full min-h-[400px]">
              <div className="flex items-center gap-2 mb-6 border-b border-[#1C1C1C] pb-4">
                <h2 className="text-white font-bold text-[15px]">Expiring Soon</h2>
                {data.members.expiringSoon.length > 0 && (
                  <span className="bg-[#D11F00] text-white text-[10px] font-bold px-2 py-0.5 rounded-full leading-none">
                    {data.members.expiringSoon.length}
                  </span>
                )}
              </div>

              <div className="flex-1 flex flex-col">
                {data.members.expiringSoon.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-[#333333] text-[13px] font-medium">No expiring members</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {data.members.expiringSoon.map((member, i) => (
                      <div key={member.id}>
                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col">
                            <span className="text-white text-[13px] font-medium leading-tight group-hover:text-[#D11F00] transition-colors">{member.name}</span>
                            <span className="text-[#444444] text-[11px] mt-0.5">{member.phone}</span>
                          </div>
                          
                          {member.daysLeft <= 2 ? (
                            <div className="bg-[#D11F00]/20 text-[#D11F00] text-[10px] font-bold px-2 py-1 rounded-sm uppercase border border-[#D11F00]/30 tracking-wider">
                              {member.daysLeft === 0 ? 'Today' : `${member.daysLeft} days`}
                            </div>
                          ) : member.daysLeft <= 5 ? (
                            <div className="bg-[#FF6B00]/10 text-[#FF6B00] text-[10px] font-bold px-2 py-1 rounded-sm uppercase border border-[#FF6B00]/20 tracking-wider">
                              {member.daysLeft} days
                            </div>
                          ) : (
                            <div className="bg-[#1C1C1C] text-[#555555] text-[10px] font-bold px-2 py-1 rounded-sm uppercase border border-[#242424] tracking-wider">
                              {member.daysLeft} days
                            </div>
                          )}
                        </div>
                        {i < data.members.expiringSoon.length - 1 && (
                          <div className="w-full h-px bg-[#1C1C1C] mt-4" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </>
      ) : (
        <div className="text-[#D11F00] text-sm">Failed to load dashboard data.</div>
      )}
    </div>
  )
}
