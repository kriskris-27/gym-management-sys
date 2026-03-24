import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client']
  }
};

module.exports = {
  allowedDevOrigins: ['172.20.10.5'],
};

export default nextConfig;
