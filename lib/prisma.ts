import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig, Pool } from "@neondatabase/serverless"

// Configure WebSocket for local development environments
if (process.env.NODE_ENV === "development") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require("ws")
  neonConfig.webSocketConstructor = ws
}

const globalForPrisma = global as unknown as {
  prisma: PrismaClient
}

/**
 * Creates a new Prisma client instance using Neon's serverless HTTP/WebSocket adapter.
 * Optimized for serverless deployments and cold-start resistance.
 */
function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
  })
  const adapter = new PrismaNeon(pool)
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  })
}

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient()

export default prisma

/**
 * Health check utility
 */
export async function pingDB() {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    // Silent fail
  }
}
