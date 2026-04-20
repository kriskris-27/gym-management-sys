import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // Include localhost so `npm run test:simulated:lifecycle` (127.0.0.1) matches the same dev server as LAN URLs.
  allowedDevOrigins: ["127.0.0.1", "localhost", "172.20.10.5"],
}

export default nextConfig
