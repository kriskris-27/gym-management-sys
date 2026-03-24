// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client") as any

import bcrypt from "bcryptjs"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new (PrismaClient as any)()

async function main() {
  const hashedPassword = await bcrypt.hash("admin123", 10)

  await prisma.owner.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      password: hashedPassword,
    },
  })

  const defaultPrices = [
    { membershipType: "MONTHLY",           amount: 1000 },
    { membershipType: "QUARTERLY",         amount: 2500 },
    { membershipType: "HALF_YEARLY",       amount: 4500 },
    { membershipType: "ANNUAL",            amount: 8000 },
    { membershipType: "PERSONAL_TRAINING", amount: 0    },
  ] as const

  for (const price of defaultPrices) {
    await prisma.planPricing.upsert({
      where:  { membershipType: price.membershipType },
      update: { amount: price.amount },
      create: price,
    })
  }
  console.log("✅ Default plan prices seeded")

  console.log("✅ Owner account created")
  console.log("   Username: admin")
  console.log("   Password: admin123")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())