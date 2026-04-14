"use client"

import { useMemo, useState } from "react"
import { DateTime } from "luxon"
import { useRouter } from "next/navigation"
import SpeedLoader from "@/app/components/SpeedLoader"
import { adminPageLoadingClass, adminPageShellClass } from "@/app/components/admin-page-shell"
import { useAttendanceByDate } from "@/hooks/useAttendance"
import { formatDuration, statCountClass } from "@/lib/utils"
import { formatGymTime, GYM_TIMEZONE, todayYmdInIST } from "@/lib/gym-datetime"

type AttendanceHistorySession = {
  id: string
  memberId: string
  memberName: string
  memberPhone: string
  checkedInAt: string
  checkedOutAt: string | null
  durationMinutes: number | null
  durationFormatted: string
  autoClosed: boolean
  status: string
  closeReason: string | null
}

type AttendanceHistoryResponse = {
  success: boolean
  sessions: AttendanceHistorySession[]
}

function getDateLabel(ymd: string): string {
  const dt = DateTime.fromISO(ymd, { zone: GYM_TIMEZONE }).startOf("day")
  return dt.isValid ? dt.toFormat("cccc, d LLLL yyyy") : ymd
}

function sessionStatusLabel(s: AttendanceHistorySession): string {
  if (s.autoClosed || s.status === "AUTO_CLOSED") return "Auto-closed"
  if (s.status === "OPEN") return "Open"
  if (s.status === "INVALID") return "Invalid"
  if (s.status === "CLOSED") return "Closed"
  return s.status
}

export default function AttendanceHistoryPage() {
  const router = useRouter()
  const [selectedDate, setSelectedDate] = useState(todayYmdInIST())

  const { data: rawData, isLoading, isError } = useAttendanceByDate(selectedDate)
  const data = rawData as AttendanceHistoryResponse | undefined
  const sessions = data?.sessions ?? []

  const uniqueMembers = useMemo(
    () => new Set(sessions.map((s) => s.memberId)).size,
    [sessions]
  )
  const avgDuration = useMemo(() => {
    const withDuration = sessions.filter(
      (s) => s.durationMinutes != null && Number.isFinite(s.durationMinutes)
    )
    if (withDuration.length === 0) return null
    const totalMinutes = withDuration.reduce((sum, s) => sum + (s.durationMinutes as number), 0)
    return totalMinutes / withDuration.length
  }, [sessions])

  if (isLoading) {
    return (
      <div className={adminPageLoadingClass}>
        <SpeedLoader />
        <p className="text-[#666666] text-[12px] tracking-wider uppercase">Loading attendance history</p>
      </div>
    )
  }

  return (
    <div className={adminPageShellClass}>
      <div className="flex items-start justify-between animate-page">
        <div>
          <h1 className="text-white text-[28px] font-black tracking-tight">Attendance History</h1>
          <p className="text-[#444444] text-[13px] mt-1">{getDateLabel(selectedDate)}</p>
        </div>
        <button
          onClick={() => router.push("/admin/attendance")}
          className="px-3 py-1.5 rounded-md text-[11px] font-medium border border-[#2A2A2A] bg-[#111111] text-white hover:border-[#D11F00]/40 hover:text-[#D11F00] transition-colors duration-200 cursor-pointer"
        >
          Back to Live
        </button>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <label className="text-[#555555] text-[10px] font-bold tracking-[0.15em] uppercase">Date</label>
        <input
          type="date"
          value={selectedDate}
          onClick={(e) => e.currentTarget.showPicker?.()}
          onFocus={(e) => e.currentTarget.showPicker?.()}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="bg-[#111111] border border-[#1C1C1C] text-white text-[12px] px-3 py-2 rounded-lg focus:border-[#D11F00] focus:outline-none transition-colors [color-scheme:dark] cursor-pointer"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5 animate-page">
        <div className="themeFxCardOuter min-h-[110px]">
          <div className="themeFxCard">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10 min-w-0 w-full">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">
                Sessions
              </p>
              <p className={`text-white font-black ${statCountClass}`}>{sessions.length}</p>
              <p className="text-[#c9c9c9] text-[11px] mt-2">for selected date</p>
            </div>
          </div>
        </div>

        <div className="themeFxCardOuter min-h-[110px]">
          <div className="themeFxCard">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10 min-w-0 w-full">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">
                Members
              </p>
              <p className={`text-white font-black ${statCountClass}`}>{uniqueMembers}</p>
              <p className="text-[#c9c9c9] text-[11px] mt-2">unique check-ins</p>
            </div>
          </div>
        </div>

        <div className="themeFxCardOuter min-h-[110px]">
          <div className="themeFxCard">
            <div className="themeFxCardRay" />
            <div className="themeFxCardLine themeFxCardLineTop" />
            <div className="themeFxCardLine themeFxCardLineBottom" />
            <div className="themeFxCardLine themeFxCardLineLeft" />
            <div className="themeFxCardLine themeFxCardLineRight" />
            <div className="relative z-10 min-w-0 w-full">
              <p className="text-[#b9b9b9] text-[10px] tracking-widest uppercase font-bold mb-3">
                Avg Duration
              </p>
              <p className="text-white font-black tabular-nums leading-tight min-w-0 text-[clamp(1rem,3.8vw+0.5rem,1.75rem)] break-words">
                {avgDuration !== null ? formatDuration(avgDuration) : "—"}
              </p>
              <p className="text-[#c9c9c9] text-[11px] mt-2">sessions with checkout only</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-[#111111] border border-[#1C1C1C] rounded-xl overflow-hidden animate-page">
        <div className="px-5 py-4 border-b border-[#1C1C1C]">
          <h2 className="text-white font-bold text-[14px]">Sessions</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px]">
            <thead className="border-b border-[#1C1C1C] bg-[#0D0D0D]">
              <tr>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Member</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Check In</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Check Out</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Duration</th>
                <th className="text-[#333333] text-[10px] tracking-widest uppercase px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {isError ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-[#D11F00] text-[14px] font-medium">Failed to load attendance history</p>
                    <p className="text-[#2A2A2A] text-[12px] mt-1">Please retry with another date</p>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-[#333333] text-[14px] font-medium">No attendance sessions found</p>
                    <p className="text-[#2A2A2A] text-[12px] mt-1">Try a different date</p>
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-[#0D0D0D] hover:bg-[#0D0D0D] transition-colors duration-150 cursor-pointer group"
                    onClick={() => router.push(`/admin/members/${session.memberId}`)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex flex-col">
                        <span className="text-white text-[13px] font-medium leading-tight group-hover:text-[#D11F00] transition-colors">
                          {session.memberName}
                        </span>
                        <span className="text-[#444444] text-[11px] mt-0.5">{session.memberPhone}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-[#666666] text-[12px]">{formatGymTime(session.checkedInAt)}</span>
                    </td>
                    <td className="px-5 py-4">
                      {session.checkedOutAt ? (
                        <span className="text-[#666666] text-[12px]">
                          {formatGymTime(session.checkedOutAt)}
                        </span>
                      ) : (
                        <span className="text-[#333333] text-[12px]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {session.durationMinutes != null ? (
                        <span className="text-[#888888] text-[12px]">
                          {formatDuration(session.durationMinutes)}
                        </span>
                      ) : (
                        <span className="text-[#444444] text-[12px] italic">Open</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`text-[11px] font-medium ${
                            session.autoClosed || session.status === "AUTO_CLOSED"
                              ? "text-[#888888]"
                              : session.status === "OPEN"
                                ? "text-[#D11F00]"
                                : "text-[#555555]"
                          }`}
                        >
                          {sessionStatusLabel(session)}
                        </span>
                        {session.closeReason ? (
                          <span className="text-[#3a3a3a] text-[10px]">{session.closeReason}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
