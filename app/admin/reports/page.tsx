"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { useMonthlyReport } from "@/hooks/useReports"

const istOffset = 5.5 * 60 * 60 * 1000
function getISTNow() {
  return new Date(Date.now() + istOffset)
}
function currentISTYear() {
  return getISTNow().getUTCFullYear()
}
function currentISTMonth() {
  return getISTNow().getUTCMonth() + 1
}

const BarChart = dynamic(
  () => import("recharts").then((m) => ({ default: m.BarChart })),
  { ssr: false }
)
const Bar = dynamic(
  () => import("recharts").then((m) => ({ default: m.Bar })),
  { ssr: false }
)
const LineChart = dynamic(
  () => import("recharts").then((m) => ({ default: m.LineChart })),
  { ssr: false }
)
const ComposedChart = dynamic(
  () => import("recharts").then((m) => ({ default: m.ComposedChart })),
  { ssr: false }
)
const Line = dynamic(
  () => import("recharts").then((m) => ({ default: m.Line })),
  { ssr: false }
)
const Area = dynamic(
  () => import("recharts").then((m) => ({ default: m.Area })),
  { ssr: false }
)
const PieChart = dynamic(
  () => import("recharts").then((m) => ({ default: m.PieChart })),
  { ssr: false }
)
const Pie = dynamic(
  () => import("recharts").then((m) => ({ default: m.Pie })),
  { ssr: false }
)
const Cell = dynamic(
  () => import("recharts").then((m) => ({ default: m.Cell })),
  { ssr: false }
)
const XAxis = dynamic(
  () => import("recharts").then((m) => ({ default: m.XAxis })),
  { ssr: false }
)
const YAxis = dynamic(
  () => import("recharts").then((m) => ({ default: m.YAxis })),
  { ssr: false }
)
const CartesianGrid = dynamic(
  () => import("recharts").then((m) => ({ default: m.CartesianGrid })),
  { ssr: false }
)
const Tooltip = dynamic(
  () => import("recharts").then((m) => ({ default: m.Tooltip })),
  { ssr: false }
)
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => ({ default: m.ResponsiveContainer })),
  { ssr: false }
)

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const YEARS = [2024, 2025, 2026]

const PLAN_ORDER = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
  "PERSONAL_TRAINING",
] as const

const PLAN_COLORS: Record<(typeof PLAN_ORDER)[number], string> = {
  MONTHLY: "#D11F00",
  QUARTERLY: "#F59E0B",
  HALF_YEARLY: "#10B981",
  ANNUAL: "#3B82F6",
  PERSONAL_TRAINING: "#8B5CF6",
}

const PLAN_LABEL: Record<(typeof PLAN_ORDER)[number], string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half Yearly",
  ANNUAL: "Annual",
  PERSONAL_TRAINING: "Personal Training",
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function padDailyAmounts(
  year: number,
  month: number,
  breakdown: { date: string; amount: number }[]
) {
  const map = new Map(breakdown.map((d) => [d.date, d.amount]))
  const days = daysInMonth(year, month)
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return {
      dayLabel: String(day),
      date: dateStr,
      amount: map.get(dateStr) ?? 0,
    }
  })
}

function padDailyCounts(
  year: number,
  month: number,
  breakdown: { date: string; count: number }[]
) {
  const map = new Map(breakdown.map((d) => [d.date, d.count]))
  const days = daysInMonth(year, month)
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    return {
      dayLabel: String(day),
      date: dateStr,
      count: map.get(dateStr) ?? 0,
    }
  })
}

function formatRupeeTick(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}k`
  return `₹${v}`
}

function formatBarTooltipLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00+05:30")
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  })
}

function formatHourTick(h: number) {
  if (h === 0) return "12AM"
  if (h < 12) return `${h}AM`
  if (h === 12) return "12PM"
  return `${h - 12}PM`
}

const PEAK_HOUR_RANGE = Array.from({ length: 18 }, (_, i) => i + 5)

const LABEL_HOURS = new Set([5, 8, 11, 14, 17, 20])

type MonthlyReport = {
  period: { year: number; month: number; label: string }
  revenue: {
    total: number
    byPlan: Record<string, number>
    byMode: { CASH: number; UPI: number; CARD: number }
    dailyBreakdown: { date: string; amount: number; count: number }[]
  }
  members: {
    newThisMonth: number
    renewalsThisMonth: number
    activeTotal: number
    expiredThisMonth: number
  }
  attendance: {
    totalSessions: number
    uniqueMembers: number
    averageSessionMinutes: number
    dailyBreakdown: { date: string; count: number; averageDuration: number }[]
    peakHour: number
    hourHeatmap: number[]
  }
}

export default function AdminReportsPage() {
  const [year, setYear] = useState(currentISTYear)
  const [month, setMonth] = useState(currentISTMonth)
  const [barsReady, setBarsReady] = useState(false)

  const { data: rawData, isLoading, isError } = useMonthlyReport(year, month)
  const data = rawData as MonthlyReport | undefined

  useEffect(() => {
    setBarsReady(false)
    const t = requestAnimationFrame(() => {
      setBarsReady(true)
    })
    return () => cancelAnimationFrame(t)
  }, [year, month, data?.revenue?.total])

  const isEmptyMonth = useMemo(() => {
    if (!data) return false
    return (
      data.revenue.total === 0 &&
      data.attendance.totalSessions === 0 &&
      data.members.newThisMonth === 0 &&
      (data.members.renewalsThisMonth ?? 0) === 0
    )
  }, [data])

  const dailyRevenue = useMemo(
    () => (data ? padDailyAmounts(year, month, data.revenue.dailyBreakdown) : []),
    [data, year, month]
  )

  const dailyAttendance = useMemo(
    () => (data ? padDailyCounts(year, month, data.attendance.dailyBreakdown) : []),
    [data, year, month]
  )

  const pieData = useMemo(() => {
    if (!data) return []
    return PLAN_ORDER.map((key) => ({
      key,
      name: PLAN_LABEL[key],
      value: data.revenue.byPlan[key] ?? 0,
      fill: PLAN_COLORS[key],
    })).filter((d) => d.value > 0)
  }, [data])

  const planLegend = useMemo(() => {
    if (!data) return []
    return PLAN_ORDER.map((key) => ({
      key,
      name: PLAN_LABEL[key],
      amount: data.revenue.byPlan[key] ?? 0,
      fill: PLAN_COLORS[key],
    }))
  }, [data])

  const totalRevenue = data?.revenue.total ?? 0
  const cashAmount = data?.revenue.byMode.CASH ?? 0
  const upiAmount = data?.revenue.byMode.UPI ?? 0
  const cardAmount = data?.revenue.byMode.CARD ?? 0

  const pct = (part: number) =>
    totalRevenue > 0 ? Math.min(100, Math.round((part / totalRevenue) * 1000) / 10) : 0

  const hourHeatmap = data?.attendance.hourHeatmap ?? Array(24).fill(0)
  const peakRangeCounts = PEAK_HOUR_RANGE.map((h) => hourHeatmap[h] ?? 0)
  const maxPeak = Math.max(...peakRangeCounts, 1)
  const peakHour = data?.attendance.peakHour ?? 0

  const avgMins = data?.attendance.averageSessionMinutes ?? 0
  const hrs = Math.floor(avgMins / 60)
  const mins = avgMins % 60
  const avgSessionDisplay =
    avgMins === 0 ? "—" : `${hrs}hr ${mins}min`

  const chartKey = `${year}-${month}`

  const BarTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: { payload: { date: string; amount: number } }[]
  }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    const label = formatBarTooltipLabel(p.date)
    return (
      <div
        className="rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-3 py-2 text-[12px] text-white shadow-lg"
        style={{ outline: "none" }}
      >
        {label}: ₹{p.amount.toLocaleString("en-IN")}
      </div>
    )
  }

  const LineTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: { payload: { date: string; count: number } }[]
  }) => {
    if (!active || !payload?.length) return null
    const p = payload[0].payload
    const label = formatBarTooltipLabel(p.date)
    return (
      <div className="rounded-lg border border-[#2A2A2A] bg-[#1C1C1C] px-3 py-2 text-[12px] text-white shadow-lg">
        {label}: {p.count} visits
      </div>
    )
  }

  if (isError && !isLoading) {
    return (
      <div className="min-h-screen w-full bg-[#080808] p-8">
        <p className="text-[14px] text-[#666666]">
          Could not load report. Try again later.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-full animate-[pageFade_0.4s_ease-out] bg-[#080808] p-8">
        <style>{`
          @keyframes pageFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl bg-[#1C1C1C]"
            />
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-[280px] animate-pulse rounded-xl bg-[#1C1C1C]" />
          <div className="h-[280px] animate-pulse rounded-xl bg-[#1C1C1C]" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-[280px] animate-pulse rounded-xl bg-[#1C1C1C]" />
          <div className="h-[280px] animate-pulse rounded-xl bg-[#1C1C1C]" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full animate-[pageFade_0.4s_ease-out] bg-[#080808] p-8">
      <style>{`
        @keyframes pageFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes chartFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .chart-fade-in {
          animation: chartFade 0.4s ease-out forwards;
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] font-black text-white">Reports</h1>
          <p className="text-[13px] text-[#444444]">Monthly analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-lg border border-[#1C1C1C] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
            >
              {MONTHS.map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-lg border border-[#1C1C1C] bg-[#111111] px-3 py-2 text-[12px] text-white focus:border-[#D11F00] focus:outline-none"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => alert("PDF export coming soon")}
            className="rounded-lg border border-[#242424] bg-transparent px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-[#444444] hover:text-white"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#666666]">
            TOTAL REVENUE
          </p>
          <p className="mt-2 text-[32px] font-black text-white">
            ₹{(data?.revenue.total ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="mt-1 text-[12px] text-[#444444]">{data?.period.label}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#666666]">
            NEW MEMBERS
          </p>
          <p className="mt-2 text-[32px] font-black text-white">
            {data?.members.newThisMonth ?? 0}
          </p>
          <p className="mt-1 text-[12px] text-[#444444]">
            {(data?.members.renewalsThisMonth ?? 0).toLocaleString("en-IN")} renewals
          </p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#666666]">
            TOTAL SESSIONS
          </p>
          <p className="mt-2 text-[32px] font-black text-white">
            {data?.attendance.totalSessions ?? 0}
          </p>
          <p className="mt-1 text-[12px] text-[#444444]">
            {data?.attendance.uniqueMembers ?? 0} unique members
          </p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#666666]">
            AVG SESSION
          </p>
          <p className="mt-2 text-[32px] font-black text-white">
            {avgSessionDisplay}
          </p>
          <p className="mt-1 text-[12px] text-[#444444]">per visit</p>
        </div>
      </div>

      {/* Charts row 1 */}
      <div
        key={`r1-${chartKey}`}
        className="chart-fade-in mt-6 grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <div className="rounded-xl border border-[#1C1C1C] bg-[#111111] p-5">
          <p className="text-[14px] font-bold text-white">Daily Revenue</p>
          <div className="relative mt-4 h-[240px]">
            {isEmptyMonth ? (
              <div className="flex h-full items-center justify-center text-[13px] text-[#333333]">
                No data for {data?.period.label}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dailyRevenue} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1C1C1C" vertical={false} />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fill: "#666666", fontSize: 11 }}
                    axisLine={{ stroke: "#1C1C1C" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#666666", fontSize: 11 }}
                    axisLine={{ stroke: "#1C1C1C" }}
                    tickLine={false}
                    tickFormatter={(v) => formatRupeeTick(Number(v))}
                  />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(209,31,0,0.06)" }} />
                  <Bar
                    dataKey="amount"
                    fill="#D11F00"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive
                    animationDuration={600}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#1C1C1C] bg-[#111111] p-5">
          <p className="text-[14px] font-bold text-white">Revenue by Plan</p>
          <div className="relative mt-4 flex h-[240px] flex-col">
            {(data?.revenue.total ?? 0) === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[13px] text-[#333333]">
                No revenue this month
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      isAnimationActive
                      animationDuration={500}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} stroke="transparent" />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2">
                  {planLegend.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-2 text-[12px] text-[#666666]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.fill }}
                      />
                      <span>{row.name}</span>
                      <span className="text-[#888888]">
                        ₹{row.amount.toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div
        key={`r2-${chartKey}`}
        className="chart-fade-in mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <div className="rounded-xl border border-[#1C1C1C] bg-[#111111] p-5">
          <p className="text-[14px] font-bold text-white">Daily Attendance</p>
          <div className="relative mt-4 h-[200px]">
            {isEmptyMonth ? (
              <div className="flex h-full items-center justify-center text-[13px] text-[#333333]">
                No data for {data?.period.label}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={dailyAttendance} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`attFill-${chartKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D11F00" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#D11F00" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1C1C1C" vertical={false} />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fill: "#666666", fontSize: 11 }}
                    axisLine={{ stroke: "#1C1C1C" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#666666", fontSize: 11 }}
                    axisLine={{ stroke: "#1C1C1C" }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<LineTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="none"
                    fill={`url(#attFill-${chartKey})`}
                    isAnimationActive
                    animationDuration={500}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#D11F00"
                    strokeWidth={2}
                    dot={{ fill: "#D11F00", r: 3 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive
                    animationDuration={500}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#1C1C1C] bg-[#111111] p-5">
          <p className="text-[14px] font-bold text-white">Payment Methods</p>
          <div className="mt-6 space-y-6">
            {totalRevenue === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center text-[13px] text-[#333333]">
                No data for {data?.period.label}
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-2 flex justify-between text-[12px] text-white">
                    <span>Cash</span>
                    <span>₹{cashAmount.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#1C1C1C]">
                    <div
                      className="h-2 rounded-full bg-[#10B981] transition-all duration-500 ease-out"
                      style={{ width: barsReady ? `${pct(cashAmount)}%` : "0%" }}
                    />
                  </div>
                  <p className="mt-1 text-[12px] text-[#666666]">
                    ₹{cashAmount.toLocaleString("en-IN")}
                  </p>
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-[12px] text-white">
                    <span>UPI</span>
                    <span>₹{upiAmount.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#1C1C1C]">
                    <div
                      className="h-2 rounded-full bg-[#3B82F6] transition-all duration-500 ease-out"
                      style={{ width: barsReady ? `${pct(upiAmount)}%` : "0%" }}
                    />
                  </div>
                  <p className="mt-1 text-[12px] text-[#666666]">
                    ₹{upiAmount.toLocaleString("en-IN")}
                  </p>
                </div>
                <div>
                  <div className="mb-2 flex justify-between text-[12px] text-white">
                    <span>Card</span>
                    <span>₹{cardAmount.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#1C1C1C]">
                    <div
                      className="h-2 rounded-full bg-[#8B5CF6] transition-all ease-out"
                      style={{
                        width: barsReady ? `${pct(cardAmount)}%` : "0%",
                        transitionDuration: "500ms",
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[12px] text-[#666666]">
                    ₹{cardAmount.toLocaleString("en-IN")}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Peak hours */}
      <div
        key={`peak-${chartKey}`}
        className="chart-fade-in mt-4 rounded-xl border border-[#1C1C1C] bg-[#111111] p-5"
      >
        <p className="text-[14px] font-bold text-white">Peak Hours</p>
        <p className="text-[12px] text-[#444444]">Most popular check-in times</p>
        {isEmptyMonth ? (
          <div className="mt-8 flex justify-center text-[13px] text-[#333333]">
            No data for {data?.period.label}
          </div>
        ) : (
          <>
            <div className="mt-6 flex h-36 items-end gap-1 sm:gap-1.5">
              {PEAK_HOUR_RANGE.map((h) => {
                const c = hourHeatmap[h] ?? 0
                const heightPct = (c / maxPeak) * 100
                const isPeak = h === peakHour
                return (
                  <div
                    key={h}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`${h}:00 — ${c} check-ins`}
                  >
                    <div className="flex h-24 w-full max-w-[14px] items-end justify-center">
                      <div
                        className={`w-full rounded-t-sm transition-colors ${
                          isPeak
                            ? "bg-[#D11F00]"
                            : "bg-[#1C1C1C] hover:bg-[#D11F00]/50"
                        }`}
                        style={{
                          height: `${Math.max(heightPct, c > 0 ? 8 : 2)}%`,
                          minHeight: c > 0 ? 4 : 2,
                        }}
                      />
                    </div>
                    <span className="min-h-[14px] text-center text-[10px] leading-none text-[#444444]">
                      {LABEL_HOURS.has(h) ? formatHourTick(h) : ""}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[12px] font-bold text-[#D11F00]">
              Busiest at {peakHour}:00 — {peakHour + 1}:00
            </p>
          </>
        )}
      </div>
    </div>
  )
}
