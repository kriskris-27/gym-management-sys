"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { adminPageLoadingClass, adminPageShellClass } from "@/app/components/admin-page-shell"
import SpeedLoader from "@/app/components/SpeedLoader"
import { statCountClass } from "@/lib/utils"

type NotificationStatus = "SENT" | "FAILED" | "SKIPPED"
type NotificationType = "EXPIRY_5_DAY" | "EXPIRY_1_DAY" | "INACTIVITY"

type NotificationLogRow = {
  id: string
  memberId: string
  memberNameSnapshot: string
  recipientPhone: string
  type: NotificationType
  status: NotificationStatus
  runId: string
  channel: string
  templateKey: string
  providerMessageId: string | null
  errorCode: string | null
  errorMessage: string | null
  attemptNumber: number
  sentAt: string
}

type LogsResponse = {
  page: number
  limit: number
  total: number
  totalPages: number
  items: NotificationLogRow[]
}

type SummaryResponse = {
  totals: {
    total: number
    sent: number
    failed: number
    skipped: number
    successRate: number
  }
  latestActivityAt: string | null
  latestRunId: string | null
  recentRuns: Array<{
    runId: string
    total: number
    sent: number
    failed: number
    skipped: number
  }>
}

const STATUS_OPTIONS: NotificationStatus[] = ["SENT", "FAILED", "SKIPPED"]
const TYPE_OPTIONS: NotificationType[] = ["EXPIRY_5_DAY", "EXPIRY_1_DAY", "INACTIVITY"]

function statusBadgeClass(status: NotificationStatus) {
  if (status === "SENT") return "bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30"
  if (status === "FAILED") return "bg-[#D11F00]/20 text-[#D11F00] border-[#D11F00]/30"
  return "bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30"
}

function niceType(type: NotificationType) {
  if (type === "EXPIRY_5_DAY") return "Expiry (5 day)"
  if (type === "EXPIRY_1_DAY") return "Expiry (1 day)"
  return "Inactivity"
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [status, setStatus] = useState<"" | NotificationStatus>("")
  const [type, setType] = useState<"" | NotificationType>("")
  const [query, setQuery] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    })
    if (status) params.set("status", status)
    if (type) params.set("type", type)
    if (query.trim()) params.set("q", query.trim())
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    return params.toString()
  }, [page, limit, status, type, query, from, to])

  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ["notifications", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/admin/notifications/summary", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to fetch notifications summary")
      return (await res.json()) as SummaryResponse
    },
    refetchInterval: 15_000,
  })

  const logsQuery = useQuery<LogsResponse>({
    queryKey: ["notifications", "logs", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/admin/notifications/logs?${queryString}`, { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to fetch notification logs")
      return (await res.json()) as LogsResponse
    },
    refetchInterval: 10_000,
  })

  if (summaryQuery.isLoading && logsQuery.isLoading) {
    return (
      <div className={adminPageLoadingClass}>
        <SpeedLoader />
        <p className="text-[#555555] text-sm">Loading notifications...</p>
      </div>
    )
  }

  const summary = summaryQuery.data
  const logs = logsQuery.data

  return (
    <div className={adminPageShellClass}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] font-black text-white">Notifications</h1>
          <p className="text-[13px] text-[#444444]">Delivery transparency and audit trail</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b9b9b9]">Total Attempts</p>
          <p className={`mt-2 font-black text-white ${statCountClass}`}>{summary?.totals.total ?? 0}</p>
        </div>
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b9b9b9]">Sent</p>
          <p className={`mt-2 font-black text-[#10B981] ${statCountClass}`}>{summary?.totals.sent ?? 0}</p>
        </div>
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b9b9b9]">Failed</p>
          <p className={`mt-2 font-black text-[#D11F00] ${statCountClass}`}>{summary?.totals.failed ?? 0}</p>
        </div>
        <div className="bg-[#111111] border border-[#1C1C1C] rounded-xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b9b9b9]">Success Rate</p>
          <p className={`mt-2 font-black text-[#F59E0B] ${statCountClass}`}>{summary?.totals.successRate ?? 0}%</p>
        </div>
      </div>

      <div className="mt-6 bg-[#111111] border border-[#1C1C1C] rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <input
            value={query}
            onChange={(e) => {
              setPage(1)
              setQuery(e.target.value)
            }}
            placeholder="Search name/phone/run/error"
            className="xl:col-span-2 rounded-lg border border-[#1C1C1C] bg-[#0C0C0C] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
          />
          <select
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value as "" | NotificationStatus)
            }}
            className="rounded-lg border border-[#1C1C1C] bg-[#0C0C0C] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
          >
            <option value="">All status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => {
              setPage(1)
              setType(e.target.value as "" | NotificationType)
            }}
            className="rounded-lg border border-[#1C1C1C] bg-[#0C0C0C] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
          >
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {niceType(t)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onClick={(e) => e.currentTarget.showPicker?.()}
            onFocus={(e) => e.currentTarget.showPicker?.()}
            onChange={(e) => {
              setPage(1)
              setFrom(e.target.value)
            }}
            className="rounded-lg border border-[#1C1C1C] bg-[#0C0C0C] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
          />
          <input
            type="date"
            value={to}
            onClick={(e) => e.currentTarget.showPicker?.()}
            onFocus={(e) => e.currentTarget.showPicker?.()}
            onChange={(e) => {
              setPage(1)
              setTo(e.target.value)
            }}
            className="rounded-lg border border-[#1C1C1C] bg-[#0C0C0C] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-4 bg-[#111111] border border-[#1C1C1C] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[980px]">
            <thead>
              <tr className="border-b border-[#1C1C1C]">
                {["Time", "Member", "Phone", "Type", "Status", "Reason", "Run ID"].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#555555]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!logsQuery.isLoading && (logs?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[#444444] text-[13px]">
                    No notification logs found for selected filters.
                  </td>
                </tr>
              )}
              {logs?.items.map((row) => (
                <tr key={row.id} className="border-b border-[#1C1C1C]/60">
                  <td className="px-4 py-3 text-[12px] text-white whitespace-nowrap">
                    {new Date(row.sentAt).toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-white">
                    <div className="font-semibold">{row.memberNameSnapshot}</div>
                    <div className="text-[11px] text-[#666666]">{row.memberId}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-white">{row.recipientPhone || "—"}</td>
                  <td className="px-4 py-3 text-[12px] text-[#D0D0D0]">{niceType(row.type)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold tracking-wider ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#C9C9C9]">
                    {row.errorMessage || "Delivered"}
                    {row.errorCode ? <div className="text-[10px] text-[#7a7a7a]">{row.errorCode}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[#7a7a7a]">{row.runId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#1C1C1C] px-4 py-3">
          <p className="text-[12px] text-[#666666]">
            Showing {(logs?.items.length ?? 0) > 0 ? (page - 1) * limit + 1 : 0}
            {" - "}
            {(page - 1) * limit + (logs?.items.length ?? 0)} of {logs?.total ?? 0}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-[#242424] px-3 py-1.5 text-[12px] text-[#b5b5b5] disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-[12px] text-[#888888]">
              Page {page} / {logs?.totalPages ?? 1}
            </span>
            <button
              type="button"
              disabled={page >= (logs?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-[#242424] px-3 py-1.5 text-[12px] text-[#b5b5b5] disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
