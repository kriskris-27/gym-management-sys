import { PrismaClient } from "./client"

import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

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

  console.log("✅ Owner account created")
  console.log("   Username: admin")
  console.log("   Password: admin123")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())