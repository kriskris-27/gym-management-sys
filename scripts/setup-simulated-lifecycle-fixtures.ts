import "dotenv/config"
import { PrismaClient, type MemberStatus, type SubscriptionStatus } from "@prisma/client"
import bcrypt from "bcryptjs"
import { DateTime } from "luxon"

const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")
const PREFIX = "SIM_LC"

function phoneFromIndex(i: number) {
  return `9000000${String(i).padStart(3, "0")}`
}

type FixtureMember = {
  key: string
  name: string
  status: MemberStatus
  phone: string
}

const members: FixtureMember[] = [
  { key: "ACTIVE_PAID", name: `${PREFIX}_ACTIVE_PAID`, status: "ACTIVE", phone: phoneFromIndex(1) },
  { key: "ACTIVE_DUE", name: `${PREFIX}_ACTIVE_DUE`, status: "ACTIVE", phone: phoneFromIndex(2) },
  { key: "INACTIVE_EXPIRED", name: `${PREFIX}_INACTIVE_EXPIRED`, status: "INACTIVE", phone: phoneFromIndex(3) },
  { key: "DELETED_MEMBER", name: `${PREFIX}_DELETED_MEMBER`, status: "DELETED", phone: phoneFromIndex(4) },
  { key: "FUTURE_START", name: `${PREFIX}_FUTURE_START`, status: "ACTIVE", phone: phoneFromIndex(5) },
  { key: "EXPIRED_DUE", name: `${PREFIX}_EXPIRED_DUE`, status: "INACTIVE", phone: phoneFromIndex(6) },
]

function startOfDayUTC(daysFromNow: number): Date {
  return DateTime.now().setZone("Asia/Kolkata").startOf("day").plus({ days: daysFromNow }).toUTC().toJSDate()
}

async function ensureUsers() {
  const hash = await bcrypt.hash("sim12345", 10)
  const users = [
    { username: "sim_admin", role: "ADMIN" as const },
    { username: "sim_staff", role: "STAFF" as const },
    { username: "sim_kiosk", role: "KIOSK" as const },
  ]

  for (const u of users) {
    if (!APPLY) {
      console.log(`[dry-run] upsert user ${u.username}`)
      continue
    }
    await prisma.user.upsert({
      where: { username: u.username },
      update: { password: hash, role: u.role },
      create: { username: u.username, password: hash, role: u.role },
    })
  }
}

async function ensurePlansAndSettings() {
  const plans = [
    { name: "MONTHLY", durationDays: 30, price: 1200 },
    { name: "QUARTERLY", durationDays: 90, price: 3000 },
    { name: "HALF_YEARLY", durationDays: 180, price: 5400 },
    { name: "ANNUAL", durationDays: 365, price: 9600 },
    { name: "OTHERS", durationDays: 1, price: 0 },
  ] as const

  const settings = [
    { key: "gym_closing_time", value: { hour: 22, minute: 0 } },
    { key: "admission_fee", value: 300 },
  ] as const

  for (const p of plans) {
    if (!APPLY) {
      console.log(`[dry-run] upsert plan ${p.name}`)
      continue
    }
    await prisma.plan.upsert({
      where: { name: p.name },
      update: { durationDays: p.durationDays, price: p.price, isActive: true },
      create: { name: p.name, durationDays: p.durationDays, price: p.price, isActive: true },
    })
  }

  for (const s of settings) {
    if (!APPLY) {
      console.log(`[dry-run] upsert setting ${s.key}`)
      continue
    }
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    })
  }
}

async function ensureMembers() {
  const map = new Map<string, string>()
  for (const m of members) {
    const phoneNormalized = m.phone.replace(/\D/g, "")
    if (!APPLY) {
      console.log(`[dry-run] upsert member ${m.name} (${m.phone})`)
      map.set(m.key, `${m.key}-id`)
      continue
    }
    const row = await prisma.member.upsert({
      where: { phoneNormalized },
      update: {
        name: m.name,
        phone: m.phone,
        status: m.status,
      },
      create: {
        name: m.name,
        phone: m.phone,
        phoneNormalized,
        status: m.status,
      },
      select: { id: true },
    })
    map.set(m.key, row.id)
  }
  return map
}

async function rebuildLifecycleData(memberIds: Map<string, string>) {
  const monthly = APPLY
    ? await prisma.plan.findUniqueOrThrow({ where: { name: "MONTHLY" }, select: { id: true, price: true } })
    : { id: "plan-monthly", price: 1200 }
  const quarterly = APPLY
    ? await prisma.plan.findUniqueOrThrow({ where: { name: "QUARTERLY" }, select: { id: true, price: true } })
    : { id: "plan-quarterly", price: 3000 }

  for (const [key, memberId] of memberIds) {
    if (!APPLY) {
      console.log(`[dry-run] reset subscriptions/payments/attendance/logs for ${key}`)
      continue
    }
    await prisma.notificationLog.deleteMany({ where: { memberId } })
    await prisma.attendanceSession.deleteMany({ where: { memberId } })
    await prisma.payment.deleteMany({ where: { memberId } })
    await prisma.subscription.deleteMany({ where: { memberId } })
  }

  const scenarios: Array<{
    key: string
    status: SubscriptionStatus
    planId: string
    planName: string
    planPrice: number
    startOffset: number
    endOffset: number
    paid: number
  }> = [
    { key: "ACTIVE_PAID", status: "ACTIVE", planId: monthly.id, planName: "MONTHLY", planPrice: monthly.price, startOffset: -10, endOffset: 20, paid: monthly.price },
    { key: "ACTIVE_DUE", status: "ACTIVE", planId: quarterly.id, planName: "QUARTERLY", planPrice: quarterly.price, startOffset: -5, endOffset: 25, paid: 500 },
    { key: "INACTIVE_EXPIRED", status: "EXPIRED", planId: monthly.id, planName: "MONTHLY", planPrice: monthly.price, startOffset: -40, endOffset: -10, paid: monthly.price },
    { key: "DELETED_MEMBER", status: "CANCELLED", planId: monthly.id, planName: "MONTHLY", planPrice: monthly.price, startOffset: -20, endOffset: 10, paid: 0 },
    { key: "FUTURE_START", status: "ACTIVE", planId: monthly.id, planName: "MONTHLY", planPrice: monthly.price, startOffset: 2, endOffset: 32, paid: 0 },
    { key: "EXPIRED_DUE", status: "EXPIRED", planId: monthly.id, planName: "MONTHLY", planPrice: monthly.price, startOffset: -60, endOffset: -30, paid: 500 },
  ]

  for (const s of scenarios) {
    const memberId = memberIds.get(s.key)
    if (!memberId) continue
    if (!APPLY) {
      console.log(`[dry-run] create subscription + payment fixture for ${s.key}`)
      continue
    }

    const sub = await prisma.subscription.create({
      data: {
        memberId,
        planId: s.planId,
        startDate: startOfDayUTC(s.startOffset),
        endDate: startOfDayUTC(s.endOffset),
        status: s.status,
        planNameSnapshot: s.planName,
        planPriceSnapshot: s.planPrice,
      },
    })

    if (s.paid > 0) {
      await prisma.payment.create({
        data: {
          memberId,
          subscriptionId: sub.id,
          baseAmount: s.planPrice,
          discountAmount: 0,
          finalAmount: s.paid,
          method: "CASH",
          status: "SUCCESS",
          purpose: "SUBSCRIPTION",
          createdAt: DateTime.now().minus({ days: 1 }).toJSDate(),
        },
      })
    }
  }

  if (!APPLY) return

  const activeDueMemberId = memberIds.get("ACTIVE_DUE")
  if (activeDueMemberId) {
    const today = startOfDayUTC(0)
    const yesterday = startOfDayUTC(-1)
    const twoDaysAgo = startOfDayUTC(-2)
    const threeDaysAgo = startOfDayUTC(-3)
    await prisma.attendanceSession.createMany({
      data: [
        {
          memberId: activeDueMemberId,
          sessionDay: today,
          checkIn: DateTime.now().minus({ hours: 1 }).toJSDate(),
          checkOut: null,
          status: "OPEN",
          source: "KIOSK",
          autoClosed: false,
        },
        {
          memberId: activeDueMemberId,
          sessionDay: yesterday,
          checkIn: DateTime.now().minus({ days: 1, hours: 4 }).toJSDate(),
          checkOut: DateTime.now().minus({ days: 1, hours: 2 }).toJSDate(),
          status: "CLOSED",
          source: "KIOSK",
          autoClosed: false,
        },
        {
          memberId: activeDueMemberId,
          sessionDay: twoDaysAgo,
          checkIn: DateTime.now().minus({ days: 2, hours: 1 }).toJSDate(),
          checkOut: null,
          status: "OPEN",
          source: "KIOSK",
          autoClosed: false,
        },
        {
          memberId: activeDueMemberId,
          sessionDay: threeDaysAgo,
          checkIn: DateTime.now().minus({ days: 3, hours: 6 }).toJSDate(),
          checkOut: DateTime.now().minus({ days: 3, hours: 3 }).toJSDate(),
          status: "AUTO_CLOSED",
          source: "ADMIN",
          autoClosed: true,
          closeReason: "MAX_DURATION",
        },
      ],
    })

    // Orphan payment fixture for lifecycle coverage (legacy/manual adjustment style)
    await prisma.payment.create({
      data: {
        memberId: activeDueMemberId,
        subscriptionId: null,
        baseAmount: 0,
        discountAmount: 0,
        finalAmount: 75,
        method: "CASH",
        status: "SUCCESS",
        purpose: "ADJUSTMENT",
        notes: "Simulated orphan payment fixture",
        createdAt: DateTime.now().minus({ days: 2 }).toJSDate(),
      },
    })
  }

  const expMemberId = memberIds.get("EXPIRED_DUE")
  if (expMemberId) {
    await prisma.notificationLog.createMany({
      data: [
        {
          memberId: expMemberId,
          type: "EXPIRY_5_DAY",
          status: "FAILED",
          runId: `${PREFIX}-run-1`,
          channel: "WHATSAPP",
          recipientPhone: phoneFromIndex(6),
          memberNameSnapshot: `${PREFIX}_EXPIRED_DUE`,
          templateKey: "EXPIRY_5_DAY",
          errorCode: "SIM_ERROR",
          errorMessage: "Simulated failure",
          sentAt: DateTime.now().minus({ days: 1 }).toJSDate(),
        },
        {
          memberId: expMemberId,
          type: "INACTIVITY",
          status: "SENT",
          runId: `${PREFIX}-run-2`,
          channel: "WHATSAPP",
          recipientPhone: phoneFromIndex(6),
          memberNameSnapshot: `${PREFIX}_EXPIRED_DUE`,
          templateKey: "INACTIVITY",
          providerMessageId: `${PREFIX}-provider-1`,
          sentAt: DateTime.now().minus({ hours: 2 }).toJSDate(),
        },
        {
          memberId: expMemberId,
          type: "EXPIRY_1_DAY",
          status: "SKIPPED",
          runId: `${PREFIX}-run-3`,
          channel: "WHATSAPP",
          recipientPhone: phoneFromIndex(6),
          memberNameSnapshot: `${PREFIX}_EXPIRED_DUE`,
          templateKey: "EXPIRY_1_DAY",
          errorCode: "SKIPPED_DUPLICATE",
          errorMessage: "Simulated dedupe skip",
          sentAt: DateTime.now().minus({ minutes: 30 }).toJSDate(),
        },
      ],
    })
  }
}

async function main() {
  console.log(`\n[${PREFIX}] Preparing lifecycle fixtures (${APPLY ? "APPLY" : "DRY RUN"})`)
  await ensureUsers()
  await ensurePlansAndSettings()
  const memberIds = await ensureMembers()
  await rebuildLifecycleData(memberIds)
  console.log(`[${PREFIX}] Fixture preparation done (${APPLY ? "written" : "preview only"})\n`)
}

main()
  .catch((err) => {
    console.error(`[${PREFIX}] Fixture script failed`, err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
