import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = ['@prisma/client'];
    }
    return config;
  },
};

module.exports = {
  allowedDevOrigins: ['172.20.10.5'],
};

export default nextConfig;
