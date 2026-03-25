// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client") as any

import bcrypt from "bcryptjs"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)()

async function main() {
  const hashedPassword = await bcrypt.hash("admin123", 10)

  // Create admin user
  await prisma.user.upsert({
    where: { email: "admin@gym.com" },
    update: {},
    create: {
      email: "admin@gym.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  })

  // Create default plans
  const defaultPlans = [
    { name: "Monthly", durationDays: 30, price: 1000 },
    { name: "Quarterly", durationDays: 90, price: 2500 },
    { name: "Half Yearly", durationDays: 180, price: 4500 },
    { name: "Annual", durationDays: 365, price: 8000 },
    { name: "Personal Training", durationDays: 30, price: 0 },
  ] as const

  for (const plan of defaultPlans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: { durationDays: plan.durationDays, price: plan.price },
      create: plan,
    })
  }

  // Create default settings
  const defaultSettings = [
    { key: "gym_name", value: "Royal Fitness" },
    { key: "gym_phone", value: "+91-9876543210" },
    { key: "gym_email", value: "info@royalfitness.com" },
    { key: "session_duration_hours", value: 2 },
    { key: "auto_close_sessions", value: true },
  ] as const

  for (const setting of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    })
  }

  console.log("✅ Database seeded successfully")
  console.log("   Admin Email: admin@gym.com")
  console.log("   Admin Password: admin123")
  console.log("   Default Plans: 5 plans created")
  console.log("   Default Settings: 5 settings created")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())