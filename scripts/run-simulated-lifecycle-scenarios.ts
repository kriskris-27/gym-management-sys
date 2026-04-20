import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { DateTime } from "luxon"
import { computeGlobalMemberLedger, computeSubscriptionLedger } from "../domain/payment"

type CaseResult = {
  id: string
  area: string
  ok: boolean
  detail: string
}

const prisma = new PrismaClient()
const baseUrl = process.env.SIM_BASE_URL ?? "http://127.0.0.1:3000"
const cronSecret = process.env.CRON_SECRET ?? ""
const results: CaseResult[] = []

function push(id: string, area: string, ok: boolean, detail: string) {
  results.push({ id, area, ok, detail })
  const status = ok ? "PASS" : "FAIL"
  console.log(`[${status}] ${id} (${area}) - ${detail}`)
}

function ymd(offsetDays = 0) {
  return DateTime.now().setZone("Asia/Kolkata").plus({ days: offsetDays }).toFormat("yyyy-MM-dd")
}

function startOfDayUTC(offsetDays: number): Date {
  return DateTime.now().setZone("Asia/Kolkata").startOf("day").plus({ days: offsetDays }).toUTC().toJSDate()
}

type OracleCheck = {
  label: string
  expected: string | number | boolean
  actual: string | number | boolean
}

function evaluateOracle(id: string, area: string, checks: OracleCheck[]) {
  const failed = checks.filter((c) => c.expected !== c.actual)
  push(
    id,
    area,
    failed.length === 0,
    failed.length === 0
      ? checks.map((c) => `${c.label}=${c.actual}`).join(", ")
      : failed.map((c) => `${c.label}: expected=${c.expected}, actual=${c.actual}`).join(" | ")
  )
}

async function ensurePlan(name: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS") {
  return prisma.plan.findUniqueOrThrow({
    where: { name },
    select: { id: true, name: true, price: true, durationDays: true },
  })
}

async function wipeMemberCycle(memberId: string) {
  await prisma.notificationLog.deleteMany({ where: { memberId } })
  await prisma.attendanceSession.deleteMany({ where: { memberId } })
  await prisma.payment.deleteMany({ where: { memberId } })
  await prisma.subscription.deleteMany({ where: { memberId } })
}

async function ensureScenarioMember(name: string, phone: string) {
  const phoneNormalized = phone.replace(/\D/g, "")
  return prisma.member.upsert({
    where: { phoneNormalized },
    update: { name, phone, status: "INACTIVE" },
    create: { name, phone, phoneNormalized, status: "INACTIVE" },
    select: { id: true, name: true, phone: true },
  })
}

async function seedExpiredSubscription(params: {
  memberId: string
  planName: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL" | "OTHERS"
  price?: number
  planNameSnapshot?: string
  startOffsetDays: number
  endOffsetDays: number
  paid: number
  discount?: number
}) {
  const plan = await ensurePlan(params.planName)
  const price = params.price ?? plan.price
  const sub = await prisma.subscription.create({
    data: {
      memberId: params.memberId,
      planId: plan.id,
      startDate: startOfDayUTC(params.startOffsetDays),
      endDate: startOfDayUTC(params.endOffsetDays),
      status: "EXPIRED",
      planNameSnapshot: params.planNameSnapshot ?? plan.name,
      planPriceSnapshot: price,
    },
  })
  await prisma.payment.create({
    data: {
      memberId: params.memberId,
      subscriptionId: sub.id,
      baseAmount: price,
      discountAmount: params.discount ?? 0,
      finalAmount: params.paid,
      method: "CASH",
      status: "SUCCESS",
      purpose: "SUBSCRIPTION",
      createdAt: DateTime.now().minus({ days: 1 }).toJSDate(),
    },
  })
  await prisma.member.update({
    where: { id: params.memberId },
    data: { status: "INACTIVE" },
  })
  return sub
}

async function seedActiveSubscription(params: {
  memberId: string
  planName: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "ANNUAL"
  startOffsetDays: number
  endOffsetDays: number
  paid: number
}) {
  const plan = await ensurePlan(params.planName)
  const sub = await prisma.subscription.create({
    data: {
      memberId: params.memberId,
      planId: plan.id,
      startDate: startOfDayUTC(params.startOffsetDays),
      endDate: startOfDayUTC(params.endOffsetDays),
      status: "ACTIVE",
      planNameSnapshot: plan.name,
      planPriceSnapshot: plan.price,
    },
  })
  await prisma.payment.create({
    data: {
      memberId: params.memberId,
      subscriptionId: sub.id,
      baseAmount: plan.price,
      discountAmount: 0,
      finalAmount: params.paid,
      method: "CASH",
      status: "SUCCESS",
      purpose: "SUBSCRIPTION",
      createdAt: DateTime.now().minus({ days: 1 }).toJSDate(),
    },
  })
  await prisma.member.update({
    where: { id: params.memberId },
    data: { status: "ACTIVE" },
  })
  return sub
}

function nextPhone(seed: number, offset: number) {
  return `9${String(860000000 + seed * 20 + offset).slice(-9)}`
}

/** One fully paid, expired MONTHLY sub — matches fixture `INACTIVE_EXPIRED` (no outstanding dues). */
async function resetInactiveExpiredMemberForRenew(memberId: string) {
  const monthly = await prisma.plan.findUniqueOrThrow({ where: { name: "MONTHLY" }, select: { id: true, price: true } })
  await prisma.notificationLog.deleteMany({ where: { memberId } })
  await prisma.attendanceSession.deleteMany({ where: { memberId } })
  await prisma.payment.deleteMany({ where: { memberId } })
  await prisma.subscription.deleteMany({ where: { memberId } })
  const sub = await prisma.subscription.create({
    data: {
      memberId,
      planId: monthly.id,
      startDate: startOfDayUTC(-40),
      endDate: startOfDayUTC(-10),
      status: "EXPIRED",
      planNameSnapshot: "MONTHLY",
      planPriceSnapshot: monthly.price,
    },
  })
  await prisma.payment.create({
    data: {
      memberId,
      subscriptionId: sub.id,
      baseAmount: monthly.price,
      discountAmount: 0,
      finalAmount: monthly.price,
      method: "CASH",
      status: "SUCCESS",
      purpose: "SUBSCRIPTION",
      createdAt: DateTime.now().minus({ days: 1 }).toJSDate(),
    },
  })
  await prisma.member.update({
    where: { id: memberId },
    data: { status: "INACTIVE" },
  })
}

function parseCookie(setCookie: string | null) {
  if (!setCookie) return ""
  return setCookie.split(";")[0]
}

async function fetchJson(path: string, init?: RequestInit, cookie?: string) {
  const headers = new Headers(init?.headers ?? {})
  if (cookie) headers.set("cookie", cookie)
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json")
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { res, body }
}

async function authSuite() {
  const area = "Auth + Session"
  const login = await fetchJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "sim_admin", password: "sim12345" }),
  })
  const cookie = parseCookie(login.res.headers.get("set-cookie"))
  push("AUTH-01", area, login.res.status === 200 && cookie.includes("gym_token="), `status=${login.res.status}`)

  const bad = await fetchJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "sim_admin", password: "wrongpass" }),
    headers: { "x-forwarded-for": "55.55.55.55" },
  })
  push("AUTH-02", area, bad.res.status === 401, `status=${bad.res.status}`)

  let limited = false
  for (let i = 0; i < 12; i++) {
    const r = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "sim_admin", password: "wrongpass" }),
      headers: { "x-forwarded-for": "99.99.99.99" },
    })
    if (r.res.status === 429) limited = true
  }
  push("AUTH-03", area, limited, "rate limit reached within 12 bad attempts")

  const protectedNoAuth = await fetchJson("/api/dashboard/summary")
  push("AUTH-04", area, protectedNoAuth.res.status === 401, `status=${protectedNoAuth.res.status}`)

  const protectedAuth = await fetchJson("/api/dashboard/summary", undefined, cookie)
  const logout = await fetchJson("/api/auth/logout", { method: "POST" }, cookie)
  push("AUTH-05", area, protectedAuth.res.status === 200 && logout.res.status === 200, `dashboard=${protectedAuth.res.status}, logout=${logout.res.status}`)

  return cookie
}

async function memberSuite(cookie: string) {
  const area = "Member + Subscription"
  const phoneSeed = Math.floor(Math.random() * 10000)
  const phoneA = `9${String(700000000 + phoneSeed).slice(-9)}`
  const phoneB = `9${String(710000000 + phoneSeed).slice(-9)}`

  const createStd = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: `SIM_AUTO_STD_${phoneSeed}`,
        phone: phoneA,
        membershipType: "MONTHLY",
        startDate: ymd(0),
        discountAmount: 0,
        paidAmount: 100,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  const stdMemberId = (createStd.body as { member?: { id?: string } })?.member?.id ?? ""
  push("MEM-01", area, createStd.res.status === 201 && !!stdMemberId, `status=${createStd.res.status}`)

  const createOthers = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: `SIM_AUTO_OTH_${phoneSeed}`,
        phone: phoneB,
        membershipType: "OTHERS",
        startDate: ymd(0),
        endDate: ymd(10),
        manualPlanName: "Custom Plan",
        manualAmount: 1200,
        discountAmount: 100,
        paidAmount: 100,
        paymentMode: "UPI",
      }),
    },
    cookie
  )
  push("MEM-02", area, createOthers.res.status === 201, `status=${createOthers.res.status}`)

  const dup = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: "SIM_DUP",
        phone: phoneA,
        membershipType: "MONTHLY",
        startDate: ymd(0),
        discountAmount: 0,
        paidAmount: 0,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  push("MEM-03", area, dup.res.status === 409, `status=${dup.res.status}`)

  const invalidDiscount = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: `SIM_DISC_${phoneSeed}`,
        phone: `9${String(720000000 + phoneSeed).slice(-9)}`,
        membershipType: "MONTHLY",
        startDate: ymd(0),
        discountAmount: 99999,
        paidAmount: 0,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  push("MEM-04", area, invalidDiscount.res.status === 400, `status=${invalidDiscount.res.status}`)

  const paidTooHigh = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: `SIM_PAID_${phoneSeed}`,
        phone: `9${String(730000000 + phoneSeed).slice(-9)}`,
        membershipType: "MONTHLY",
        startDate: ymd(0),
        discountAmount: 0,
        paidAmount: 99999,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  push("MEM-05", area, paidTooHigh.res.status === 400, `status=${paidTooHigh.res.status}`)

  const invalidDate = await fetchJson(
    "/api/members",
    {
      method: "POST",
      body: JSON.stringify({
        name: `SIM_DATE_${phoneSeed}`,
        phone: `9${String(740000000 + phoneSeed).slice(-9)}`,
        membershipType: "OTHERS",
        startDate: ymd(10),
        endDate: ymd(5),
        manualPlanName: "Bad Date",
        manualAmount: 1000,
        discountAmount: 0,
        paidAmount: 0,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  push("MEM-06", area, invalidDate.res.status === 400, `status=${invalidDate.res.status}`)

  const expiredPaid = await prisma.member.findFirst({ where: { name: "SIM_LC_INACTIVE_EXPIRED" }, select: { id: true } })
  const expiredDue = await prisma.member.findFirst({ where: { name: "SIM_LC_EXPIRED_DUE" }, select: { id: true } })

  if (expiredPaid?.id) {
    // Idempotent: prior runs may leave extra subs/payments → outstanding guard blocks renew (403).
    await resetInactiveExpiredMemberForRenew(expiredPaid.id)
    const renewOk = await fetchJson(
      `/api/members/${expiredPaid.id}`,
      { method: "PATCH", body: JSON.stringify({ action: "renew", membershipType: "MONTHLY", paymentMode: "CASH", paidAmount: 100 }) },
      cookie
    )
    push("MEM-07", area, renewOk.res.status === 200, `status=${renewOk.res.status}`)
  } else {
    push("MEM-07", area, false, "fixture member missing")
  }

  if (expiredDue?.id) {
    const renewBlocked = await fetchJson(
      `/api/members/${expiredDue.id}`,
      { method: "PATCH", body: JSON.stringify({ action: "renew", membershipType: "MONTHLY", paymentMode: "CASH", paidAmount: 100 }) },
      cookie
    )
    push("MEM-08", area, renewBlocked.res.status === 403, `status=${renewBlocked.res.status}`)
  } else {
    push("MEM-08", area, false, "fixture member missing")
  }

  if (stdMemberId) {
    const del = await fetchJson(`/api/members/${stdMemberId}`, { method: "DELETE" }, cookie)
    const restore = await fetchJson(`/api/members/${stdMemberId}`, { method: "PATCH", body: JSON.stringify({ action: "restore" }) }, cookie)
    push("MEM-09", area, del.res.status === 200, `delete=${del.res.status}`)
    push("MEM-10", area, restore.res.status === 200, `restore=${restore.res.status}`)
  } else {
    push("MEM-09", area, false, "created member missing")
    push("MEM-10", area, false, "created member missing")
  }

}

async function paymentSuite(cookie: string) {
  const area = "Payments"
  const member = await prisma.member.findFirst({ where: { name: "SIM_LC_ACTIVE_DUE" }, select: { id: true } })
  const paidMember = await prisma.member.findFirst({ where: { name: "SIM_LC_ACTIVE_PAID" }, select: { id: true } })
  if (!member?.id || !paidMember?.id) {
    push("PAY-00", area, false, "fixture members missing")
    return
  }

  const pay1 = await fetchJson(
    "/api/payments",
    { method: "POST", body: JSON.stringify({ memberId: member.id, amount: 100, date: new Date().toISOString(), mode: "CASH", notes: "sim pay" }) },
    cookie
  )
  push("PAY-01", area, pay1.res.status === 201, `status=${pay1.res.status}`)

  const summary = await fetchJson(`/api/payments/summary/${member.id}`, undefined, cookie)
  let remaining = 0
  if (summary.res.status === 200) {
    remaining = Number((summary.body as { remaining?: number })?.remaining ?? 0)
    const overpayAmount = Math.min(99999, Math.max(1, remaining + 100))
    const payOver = await fetchJson(
      "/api/payments",
      { method: "POST", body: JSON.stringify({ memberId: member.id, amount: overpayAmount, date: new Date().toISOString(), mode: "UPI", notes: "overpay" }) },
      cookie
    )
    push("PAY-03", area, payOver.res.status >= 400, `status=${payOver.res.status}`)
    push("PAY-02", area, remaining >= 0, `remaining after payment=${remaining}`)
  } else {
    push("PAY-02", area, false, `summary status=${summary.res.status} (same DB as Next? load .env in script)`)
    push("PAY-03", area, false, "skipped: payment summary not available")
  }

  const payGlobalOver = await fetchJson(
    "/api/payments",
    { method: "POST", body: JSON.stringify({ memberId: paidMember.id, amount: 100, date: new Date().toISOString(), mode: "CASH", notes: "global overpay" }) },
    cookie
  )
  push("PAY-04", area, payGlobalOver.res.status >= 400, `status=${payGlobalOver.res.status}`)

  const listFilter = await fetchJson(`/api/payments?memberId=${member.id}&mode=CASH&startDate=${ymd(-3)}&endDate=${ymd(1)}`, undefined, cookie)
  push("PAY-05", area, listFilter.res.status === 200, `status=${listFilter.res.status}`)

  const summary2 = await fetchJson(`/api/payments/summary/${member.id}`, undefined, cookie)
  push("PAY-06", area, summary2.res.status === 200, `status=${summary2.res.status}`)
}

async function attendanceSuite(cookie: string) {
  const area = "Attendance"
  const member = await prisma.member.findFirst({ where: { name: "SIM_LC_ACTIVE_DUE" }, select: { id: true, phone: true } })
  if (!member?.phone || !member.id) {
    push("ATT-00", area, false, "fixture member missing")
    return
  }

  const scan1 = await fetchJson("/api/attendance/scan", { method: "POST", body: JSON.stringify({ phone: member.phone }) })
  push("ATT-01", area, scan1.res.status < 500, `status=${scan1.res.status}`)

  const scan2 = await fetchJson("/api/attendance/scan", { method: "POST", body: JSON.stringify({ phone: member.phone }) })
  push("ATT-02", area, scan2.res.status < 500, `status=${scan2.res.status}`)
  push("ATT-03", area, scan2.res.status < 500, "checkout/min-duration path does not crash")
  push("ATT-04", area, scan2.res.status < 500, "same-day duplicate path does not crash")

  if (!cronSecret) {
    push("ATT-05", area, false, "CRON_SECRET missing; cannot verify close-sessions")
    push("ATT-06", area, false, "CRON_SECRET missing; cannot verify close-sessions")
    push("ATT-07", area, false, "CRON_SECRET missing; cannot verify max-duration close")
  } else {
    // Ensure one deterministic stale open session exists for cron-close verification.
    await prisma.attendanceSession.upsert({
      where: {
        memberId_sessionDay: {
          memberId: member.id,
          sessionDay: DateTime.now().setZone("Asia/Kolkata").startOf("day").minus({ days: 9 }).toUTC().toJSDate(),
        },
      },
      update: {
        checkOut: null,
        status: "OPEN",
        autoClosed: false,
        closeReason: null,
      },
      create: {
        memberId: member.id,
        sessionDay: DateTime.now().setZone("Asia/Kolkata").startOf("day").minus({ days: 9 }).toUTC().toJSDate(),
        checkIn: DateTime.now().minus({ days: 9, hours: 2 }).toJSDate(),
        checkOut: null,
        status: "OPEN",
        source: "KIOSK",
        autoClosed: false,
      },
    })

    const close = await fetchJson("/api/cron/close-sessions", { method: "GET", headers: { Authorization: `Bearer ${cronSecret}` } })
    const closeBody = close.body as { closedSessions?: number }
    push("ATT-05", area, close.res.status === 200, `status=${close.res.status}`)
    push("ATT-06", area, close.res.status === 200 && (closeBody.closedSessions ?? 0) >= 1, `closedSessions=${closeBody.closedSessions ?? 0}`)
    push("ATT-07", area, close.res.status === 200, "max-duration close endpoint executed")
  }

  const today = await fetchJson("/api/attendance/today", undefined, cookie)
  const history = await fetchJson(`/api/attendance/history?startDate=${ymd(-1)}&endDate=${ymd(0)}`, undefined, cookie)
  const memberHistory = await fetchJson(`/api/attendance/${member.id}?page=1&limit=20`, undefined, cookie)
  const reports = await fetchJson(`/api/attendance/reports?startDate=${ymd(-7)}&endDate=${ymd(0)}`, undefined, cookie)
  const ok = [today.res.status, history.res.status, memberHistory.res.status, reports.res.status].every((s) => s === 200)
  push("ATT-08", area, ok, `today=${today.res.status},history=${history.res.status},member=${memberHistory.res.status},reports=${reports.res.status}`)
}

async function notificationsSuite(cookie: string) {
  const area = "Notifications"
  const unauth = await fetchJson("/api/cron/notify", { method: "POST" })
  push("NOTIF-01A", area, unauth.res.status === 401, `unauth=${unauth.res.status}`)

  if (!cronSecret) {
    push("NOTIF-01B", area, false, "CRON_SECRET missing; cannot run authorized notify")
    return
  }

  const authRun = await fetchJson("/api/cron/notify", { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } })
  push("NOTIF-01B", area, authRun.res.status === 200, `auth=${authRun.res.status}`)
  push("NOTIF-02", area, authRun.res.status === 200, "expiry window job executed")
  push("NOTIF-03", area, authRun.res.status === 200, "inactivity/dedupe job executed")

  const [r1, r2] = await Promise.all([
    fetchJson("/api/cron/notify", { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } }),
    fetchJson("/api/cron/notify", { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } }),
  ])
  const hasLockProtection = [r1.res.status, r2.res.status].includes(409)
  push("NOTIF-04", area, hasLockProtection, `parallel statuses=${r1.res.status},${r2.res.status}`)

  const logs = await fetchJson(`/api/admin/notifications/logs?page=1&limit=5&status=SKIPPED&from=${ymd(-7)}&to=${ymd(1)}`, undefined, cookie)
  const logsQ = await fetchJson(`/api/admin/notifications/logs?page=1&limit=5&q=SIM_LC`, undefined, cookie)
  push("NOTIF-05", area, logs.res.status === 200 && logsQ.res.status === 200, `logs=${logs.res.status},logsQ=${logsQ.res.status}`)

  const summary = await fetchJson("/api/admin/notifications/summary", undefined, cookie)
  const runs = ((summary.body as { recentRuns?: Array<{ runId: string }> })?.recentRuns ?? []).length
  push("NOTIF-06", area, summary.res.status === 200 && runs >= 1, `status=${summary.res.status},runs=${runs}`)
}

/**
 * Custom scenarios from product owner (CUS-*).
 * Current focus: create-member plan matrix across standard plans + OTHERS.
 */
async function customScenarioSuite(cookie: string) {
  const area = "Custom scenarios"
  const seed = Math.floor(Math.random() * 100000)
  const admissionSetting = await prisma.setting.findUnique({
    where: { key: "admission_fee" },
    select: { value: true },
  })
  const admissionFee = Math.max(0, Math.round(Number(admissionSetting?.value ?? 0) || 0))
  const planRows = await prisma.plan.findMany({
    where: { name: { in: ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"] } },
    select: { name: true, price: true, durationDays: true },
  })
  const planMap = new Map(planRows.map((p) => [p.name, p]))

  function phoneAt(index: number) {
    return `9${String(800000000 + seed * 10 + index).slice(-9)}`
  }

  function istYmdFromDate(date: Date) {
    return DateTime.fromJSDate(date, { zone: "utc" }).setZone("Asia/Kolkata").toFormat("yyyy-MM-dd")
  }

  async function runCreateCase(input: {
    id: string
    payload: Record<string, unknown>
    expectedPlanName: string
    expectedBase: number
    expectedPaid: number
    expectedEndDate: string
  }) {
    const res = await fetchJson(
      "/api/members",
      {
        method: "POST",
        body: JSON.stringify(input.payload),
      },
      cookie
    )

    const memberId = (res.body as { member?: { id?: string } })?.member?.id ?? ""
    if (res.res.status !== 201 || !memberId) {
      push(input.id, area, false, `create status=${res.res.status}`)
      return
    }

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: {
        subscriptions: { orderBy: { createdAt: "desc" }, take: 1 },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    })

    const sub = member?.subscriptions[0]
    const payment = member?.payments[0]
    const ok =
      !!member &&
      member.status === "ACTIVE" &&
      !!sub &&
      !!payment &&
      sub.planNameSnapshot === input.expectedPlanName &&
      sub.planPriceSnapshot === input.expectedBase &&
      payment.baseAmount === input.expectedBase &&
      payment.finalAmount === input.expectedPaid &&
      istYmdFromDate(sub.endDate) === input.expectedEndDate

    push(
      input.id,
      area,
      ok,
      ok
        ? `created ${input.expectedPlanName} base=${input.expectedBase} paid=${input.expectedPaid}`
        : `member=${member?.status ?? "missing"}, plan=${sub?.planNameSnapshot ?? "missing"}, base=${sub?.planPriceSnapshot ?? "missing"}, paid=${payment?.finalAmount ?? "missing"}, end=${sub ? istYmdFromDate(sub.endDate) : "missing"}`
    )
  }

  const start = ymd(0)
  const startDt = DateTime.fromISO(start, { zone: "Asia/Kolkata" })
  const monthly = planMap.get("MONTHLY")
  const quarterly = planMap.get("QUARTERLY")
  const halfYearly = planMap.get("HALF_YEARLY")
  const annual = planMap.get("ANNUAL")

  if (!monthly || !quarterly || !halfYearly || !annual) {
    push("CUS-01", area, false, "Required standard plans are missing in plan catalog")
    return
  }

  await runCreateCase({
    id: "CUS-01A",
    payload: {
      name: `CUS_MONTHLY_FULL_${seed}`,
      phone: phoneAt(1),
      membershipType: "MONTHLY",
      startDate: start,
      discountAmount: 0,
      paidAmount: monthly.price,
      paymentMode: "CASH",
      includeAdmission: false,
    },
    expectedPlanName: "MONTHLY",
    expectedBase: monthly.price,
    expectedPaid: monthly.price,
    expectedEndDate: startDt.plus({ days: monthly.durationDays }).toFormat("yyyy-MM-dd"),
  })

  await runCreateCase({
    id: "CUS-01B",
    payload: {
      name: `CUS_QUARTERLY_PARTIAL_${seed}`,
      phone: phoneAt(2),
      membershipType: "QUARTERLY",
      startDate: start,
      discountAmount: 0,
      paidAmount: 500,
      paymentMode: "UPI",
      includeAdmission: false,
    },
    expectedPlanName: "QUARTERLY",
    expectedBase: quarterly.price,
    expectedPaid: 500,
    expectedEndDate: startDt.plus({ days: quarterly.durationDays }).toFormat("yyyy-MM-dd"),
  })

  await runCreateCase({
    id: "CUS-01C",
    payload: {
      name: `CUS_HALF_ZERO_${seed}`,
      phone: phoneAt(3),
      membershipType: "HALF_YEARLY",
      startDate: start,
      discountAmount: 0,
      paidAmount: 0,
      paymentMode: "CARD",
      includeAdmission: false,
    },
    expectedPlanName: "HALF_YEARLY",
    expectedBase: halfYearly.price,
    expectedPaid: 0,
    expectedEndDate: startDt.plus({ days: halfYearly.durationDays }).toFormat("yyyy-MM-dd"),
  })

  await runCreateCase({
    id: "CUS-01D",
    payload: {
      name: `CUS_ANNUAL_ADMISSION_${seed}`,
      phone: phoneAt(4),
      membershipType: "ANNUAL",
      startDate: start,
      discountAmount: 0,
      paidAmount: annual.price + admissionFee,
      paymentMode: "CASH",
      includeAdmission: true,
    },
    expectedPlanName: "ANNUAL",
    expectedBase: annual.price + admissionFee,
    expectedPaid: annual.price + admissionFee,
    expectedEndDate: startDt.plus({ days: annual.durationDays }).toFormat("yyyy-MM-dd"),
  })

  await runCreateCase({
    id: "CUS-01E",
    payload: {
      name: `CUS_MONTHLY_DISCOUNT_${seed}`,
      phone: phoneAt(5),
      membershipType: "MONTHLY",
      startDate: start,
      discountAmount: 200,
      paidAmount: monthly.price - 200,
      paymentMode: "UPI",
      includeAdmission: false,
    },
    expectedPlanName: "MONTHLY",
    expectedBase: monthly.price,
    expectedPaid: monthly.price - 200,
    expectedEndDate: startDt.plus({ days: monthly.durationDays }).toFormat("yyyy-MM-dd"),
  })

  await runCreateCase({
    id: "CUS-01F",
    payload: {
      name: `CUS_OTHERS_CUSTOM_${seed}`,
      phone: phoneAt(6),
      membershipType: "OTHERS",
      startDate: start,
      endDate: ymd(45),
      manualPlanName: "Festival Offer",
      manualAmount: 1750,
      discountAmount: 250,
      paidAmount: 500,
      paymentMode: "CARD",
      includeAdmission: true,
    },
    expectedPlanName: "Festival Offer",
    expectedBase: 1750 + admissionFee,
    expectedPaid: 500,
    expectedEndDate: ymd(45),
  })

  const renewMonthly = await ensurePlan("MONTHLY")
  const renewAnnual = await ensurePlan("ANNUAL")
  const renewQuarterly = await ensurePlan("QUARTERLY")

  // CUS-02A: expired fully-paid member renews successfully, old subscription stays unchanged.
  const renewOkMember = await ensureScenarioMember(`CUS_RENEW_OK_${seed}`, nextPhone(seed, 7))
  await wipeMemberCycle(renewOkMember.id)
  const oldSubOk = await seedExpiredSubscription({
    memberId: renewOkMember.id,
    planName: "MONTHLY",
    startOffsetDays: -40,
    endOffsetDays: -10,
    paid: renewMonthly.price,
  })
  const renewOkRes = await fetchJson(
    `/api/members/${renewOkMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "renew",
        membershipType: "ANNUAL",
        paidAmount: renewAnnual.price,
        paymentMode: "UPI",
      }),
    },
    cookie
  )
  const latestSubsOk = await prisma.subscription.findMany({
    where: { memberId: renewOkMember.id },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, planNameSnapshot: true, planPriceSnapshot: true, status: true, createdAt: true },
  })
  const newSubOk = latestSubsOk[0]
  const oldSubAfterOk = latestSubsOk.find((s) => s.id === oldSubOk.id)
  const newSubLedgerOk = newSubOk ? await computeSubscriptionLedger(newSubOk.id) : null
  const oldSubLedgerOk = await computeSubscriptionLedger(oldSubOk.id)
  const globalLedgerOk = await computeGlobalMemberLedger(renewOkMember.id)
  const summaryOk = await fetchJson(`/api/payments/summary/${renewOkMember.id}`, undefined, cookie)
  evaluateOracle("CUS-02A", area, [
    { label: "status", expected: 200, actual: renewOkRes.res.status },
    { label: "newPlan", expected: "ANNUAL", actual: newSubOk?.planNameSnapshot ?? "missing" },
    { label: "newPlanAmount", expected: renewAnnual.price, actual: newSubOk?.planPriceSnapshot ?? -1 },
    { label: "newRemaining", expected: 0, actual: newSubLedgerOk?.remaining ?? -1 },
    { label: "oldPlanAmountUnchanged", expected: renewMonthly.price, actual: oldSubAfterOk?.planPriceSnapshot ?? -1 },
    { label: "oldRemainingUnchanged", expected: 0, actual: oldSubLedgerOk.remaining },
    { label: "globalRemaining", expected: 0, actual: globalLedgerOk.remaining },
    { label: "summaryStatus", expected: 200, actual: summaryOk.res.status },
    { label: "summaryRemaining", expected: 0, actual: Number((summaryOk.body as { remaining?: number })?.remaining ?? -1) },
  ])

  // CUS-02B: expired member with old due remains blocked.
  const dueMember = await ensureScenarioMember(`CUS_RENEW_DUE_${seed}`, nextPhone(seed, 8))
  await wipeMemberCycle(dueMember.id)
  await seedExpiredSubscription({
    memberId: dueMember.id,
    planName: "QUARTERLY",
    startOffsetDays: -90,
    endOffsetDays: -5,
    paid: 500,
  })
  const dueRes = await fetchJson(
    `/api/members/${dueMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "renew", membershipType: "MONTHLY", paidAmount: 200, paymentMode: "CASH" }),
    },
    cookie
  )
  evaluateOracle("CUS-02B", area, [
    { label: "status", expected: 403, actual: dueRes.res.status },
    { label: "code", expected: "OUTSTANDING_BALANCE", actual: String((dueRes.body as { code?: string })?.code ?? "missing") },
  ])

  // CUS-02C: live active plan blocks renewal.
  const liveMember = await ensureScenarioMember(`CUS_RENEW_LIVE_${seed}`, nextPhone(seed, 9))
  await wipeMemberCycle(liveMember.id)
  await seedActiveSubscription({
    memberId: liveMember.id,
    planName: "MONTHLY",
    startOffsetDays: -5,
    endOffsetDays: 25,
    paid: renewMonthly.price,
  })
  const liveRes = await fetchJson(
    `/api/members/${liveMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "renew", membershipType: "ANNUAL", paidAmount: 1000, paymentMode: "CASH" }),
    },
    cookie
  )
  evaluateOracle("CUS-02C", area, [
    { label: "status", expected: 400, actual: liveRes.res.status },
    { label: "code", expected: "ALREADY_HAS_LIVE_PLAN", actual: String((liveRes.body as { code?: string })?.code ?? "missing") },
  ])

  // CUS-02D: renewal overpay is blocked.
  const overpayMember = await ensureScenarioMember(`CUS_RENEW_OVERPAY_${seed}`, nextPhone(seed, 10))
  await wipeMemberCycle(overpayMember.id)
  await seedExpiredSubscription({
    memberId: overpayMember.id,
    planName: "MONTHLY",
    startOffsetDays: -40,
    endOffsetDays: -3,
    paid: renewMonthly.price,
  })
  const overpayRes = await fetchJson(
    `/api/members/${overpayMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "renew",
        membershipType: "MONTHLY",
        paidAmount: renewMonthly.price + 200,
        paymentMode: "CARD",
      }),
    },
    cookie
  )
  evaluateOracle("CUS-02D", area, [
    { label: "status", expected: 400, actual: overpayRes.res.status },
    { label: "code", expected: "PAID_EXCEEDS_DUE", actual: String((overpayRes.body as { code?: string })?.code ?? "missing") },
  ])

  // CUS-02E: partial renewal only affects the new subscription and current summary.
  const partialMember = await ensureScenarioMember(`CUS_RENEW_PARTIAL_${seed}`, nextPhone(seed, 11))
  await wipeMemberCycle(partialMember.id)
  const oldPartialSub = await seedExpiredSubscription({
    memberId: partialMember.id,
    planName: "MONTHLY",
    startOffsetDays: -70,
    endOffsetDays: -20,
    paid: renewMonthly.price,
  })
  const partialRes = await fetchJson(
    `/api/members/${partialMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "renew",
        membershipType: "QUARTERLY",
        paidAmount: 500,
        paymentMode: "UPI",
      }),
    },
    cookie
  )
  const partialSubs = await prisma.subscription.findMany({
    where: { memberId: partialMember.id },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, planNameSnapshot: true, planPriceSnapshot: true },
  })
  const partialNew = partialSubs[0]
  const partialNewLedger = partialNew ? await computeSubscriptionLedger(partialNew.id) : null
  const partialOldLedger = await computeSubscriptionLedger(oldPartialSub.id)
  const partialGlobal = await computeGlobalMemberLedger(partialMember.id)
  const partialSummary = await fetchJson(`/api/payments/summary/${partialMember.id}`, undefined, cookie)
  evaluateOracle("CUS-02E", area, [
    { label: "status", expected: 200, actual: partialRes.res.status },
    { label: "newPlan", expected: "QUARTERLY", actual: partialNew?.planNameSnapshot ?? "missing" },
    { label: "newRemaining", expected: renewQuarterly.price - 500, actual: partialNewLedger?.remaining ?? -1 },
    { label: "oldRemaining", expected: 0, actual: partialOldLedger.remaining },
    { label: "globalRemaining", expected: renewQuarterly.price - 500, actual: partialGlobal.remaining },
    { label: "summaryRemaining", expected: renewQuarterly.price - 500, actual: Number((partialSummary.body as { remaining?: number })?.remaining ?? -1) },
  ])

  // CUS-02F: delete/restore resets operational cycle and summary reflects only post-restore renewal.
  const restoredMember = await ensureScenarioMember(`CUS_RESTORE_ANCHOR_${seed}`, nextPhone(seed, 12))
  await wipeMemberCycle(restoredMember.id)
  await seedExpiredSubscription({
    memberId: restoredMember.id,
    planName: "MONTHLY",
    startOffsetDays: -80,
    endOffsetDays: -40,
    paid: renewMonthly.price,
  })
  const delRes = await fetchJson(`/api/members/${restoredMember.id}`, { method: "DELETE" }, cookie)
  const restoreRes = await fetchJson(
    `/api/members/${restoredMember.id}`,
    { method: "PATCH", body: JSON.stringify({ action: "restore" }) },
    cookie
  )
  const renewAfterRestoreRes = await fetchJson(
    `/api/members/${restoredMember.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        action: "renew",
        membershipType: "MONTHLY",
        paidAmount: 300,
        paymentMode: "CASH",
      }),
    },
    cookie
  )
  const restoreGlobal = await computeGlobalMemberLedger(restoredMember.id)
  const restoreSummary = await fetchJson(`/api/payments/summary/${restoredMember.id}`, undefined, cookie)
  evaluateOracle("CUS-02F", area, [
    { label: "deleteStatus", expected: 200, actual: delRes.res.status },
    { label: "restoreStatus", expected: 200, actual: restoreRes.res.status },
    { label: "renewStatus", expected: 200, actual: renewAfterRestoreRes.res.status },
    { label: "globalRemaining", expected: renewMonthly.price - 300, actual: restoreGlobal.remaining },
    { label: "summaryRemaining", expected: renewMonthly.price - 300, actual: Number((restoreSummary.body as { remaining?: number })?.remaining ?? -1) },
  ])
}

async function reconciliationSuite(cookie: string) {
  const area = "Dashboard + Reconciliation"
  const dashboard = await fetchJson("/api/dashboard/summary", undefined, cookie)
  const reports = await fetchJson(`/api/reports/monthly?year=${DateTime.now().year}&month=${DateTime.now().month}`, undefined, cookie)
  const attendanceToday = await fetchJson("/api/attendance/today", undefined, cookie)
  const payments = await fetchJson(`/api/payments?startDate=${ymd(-30)}&endDate=${ymd(1)}`, undefined, cookie)
  const members = await fetchJson("/api/members?page=1&limit=50", undefined, cookie)

  push("REC-01", area, dashboard.res.status === 200 && attendanceToday.res.status === 200 && members.res.status === 200, `dash=${dashboard.res.status},attendance=${attendanceToday.res.status},members=${members.res.status}`)
  push("REC-02", area, reports.res.status === 200 && payments.res.status === 200, `report=${reports.res.status},payments=${payments.res.status}`)
  push("REC-03", area, dashboard.res.status === 200 && reports.res.status === 200, "IST boundary aggregate endpoints responded")
}

async function main() {
  console.log(`Running simulated lifecycle suite at ${baseUrl}`)
  const cookie = await authSuite()
  await memberSuite(cookie)
  await paymentSuite(cookie)
  await attendanceSuite(cookie)
  await notificationsSuite(cookie)
  await reconciliationSuite(cookie)
  await customScenarioSuite(cookie)

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  const byArea = Array.from(new Set(results.map((r) => r.area)))
  console.log("\n=== SIMULATED LIFECYCLE RESULT SUMMARY ===")
  for (const area of byArea) {
    const rows = results.filter((r) => r.area === area)
    const p = rows.filter((r) => r.ok).length
    console.log(`${area}: ${p}/${rows.length} passed`)
  }
  console.log(`TOTAL: ${passed}/${results.length} passed, ${failed} failed`)
  if (failed > 0) {
    console.log("\nFailed cases:")
    for (const row of results.filter((r) => !r.ok)) {
      console.log(`- ${row.id}: ${row.detail}`)
    }
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error("Simulated lifecycle run failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
