import { PrismaClient } from '../prisma/client'

const prismaClientSingleton = () => {
  return new PrismaClient()
}

// In Next.js development, we want to persist the same PrismaClient instance
// so we don't exhaust your database connection pool during hot-reloads.
declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
