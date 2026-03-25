"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.pingDB = pingDB;
const client_1 = require("@prisma/client");
const adapter_neon_1 = require("@prisma/adapter-neon");
const serverless_1 = require("@neondatabase/serverless");
if (process.env.NODE_ENV === "development") {
    const ws = require("ws");
    serverless_1.neonConfig.webSocketConstructor = ws;
}
// Connection pooling for better performance
const pool = new serverless_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20, // Maximum 20 connections
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Fail fast after 10s
});
const globalForPrisma = global;
function createPrismaClient() {
    const adapter = new adapter_neon_1.PrismaNeon(pool);
    return new client_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["error"] : [],
    });
}
exports.prisma = globalForPrisma.prisma ?? createPrismaClient();
exports.default = exports.prisma;
async function pingDB() {
    try {
        await exports.prisma.$queryRaw `SELECT 1`;
    }
    catch {
        // Silent fail
    }
}
