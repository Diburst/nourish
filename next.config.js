/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // pg (and the Prisma adapter over it) are Node-only: resolve them at runtime
    // instead of bundling, so no runtime ever tries to inline `fs`.
    serverComponentsExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
