import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig, Pool } from "@neondatabase/serverless"

if (process.env.NODE_ENV === "development") {
  const ws = require("ws")
  neonConfig.webSocketConstructor = ws
}

// Connection pooling for better performance
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL!,
  max: 20, // Maximum 20 connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Fail fast after 10s
})

const globalForPrisma = global as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const adapter = new PrismaNeon(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

export default prisma

export async function pingDB() {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    // Silent fail
  }
}
