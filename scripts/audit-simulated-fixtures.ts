import "dotenv/config"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const members = await prisma.member.findMany({
    where: { name: { startsWith: "SIM_LC_" } },
    select: { id: true, name: true, status: true },
  })
  const ids = members.map((m) => m.id)
  console.log("fixture members:", members.length)

  const subByStatus = await prisma.subscription.groupBy({
    by: ["status"],
    where: { memberId: { in: ids } },
    _count: { _all: true },
  })
  console.log("subs by status:", subByStatus)

  const payLinked = await prisma.payment.count({
    where: { memberId: { in: ids }, subscriptionId: { not: null } },
  })
  const payOrphan = await prisma.payment.count({
    where: { memberId: { in: ids }, subscriptionId: null },
  })
  console.log("payments linked/orphan:", payLinked, payOrphan)

  const attOpen = await prisma.attendanceSession.count({
    where: { memberId: { in: ids }, status: "OPEN" },
  })
  const attClosed = await prisma.attendanceSession.count({
    where: { memberId: { in: ids }, status: "CLOSED" },
  })
  const attAutoClosed = await prisma.attendanceSession.count({
    where: { memberId: { in: ids }, autoClosed: true },
  })
  console.log("attendance open/closed/autoClosed:", attOpen, attClosed, attAutoClosed)

  const notifByStatus = await prisma.notificationLog.groupBy({
    by: ["status"],
    where: { memberId: { in: ids } },
    _count: { _all: true },
  })
  console.log("notification logs by status:", notifByStatus)
}

main()
  .catch((error) => {
    console.error("Fixture audit failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
