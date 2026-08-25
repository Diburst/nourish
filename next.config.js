/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // OAuth discovery lives under /.well-known, which the app router can't serve
  // directly (dot-directories are ignored); rewrite to real routes. The :path*
  // suffixes cover RFC 8414/9728 path-aware probes like
  // /.well-known/oauth-protected-resource/api/mcp.
  async rewrites() {
    return [
      { source: '/.well-known/oauth-authorization-server', destination: '/oauth/metadata' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/oauth/metadata' },
      { source: '/.well-known/openid-configuration', destination: '/oauth/metadata' },
      { source: '/.well-known/openid-configuration/:path*', destination: '/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource', destination: '/oauth/protected-resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/oauth/protected-resource' },
    ];
  },
  experimental: {
    // pg (and the Prisma adapter over it) are Node-only: resolve them at runtime
    // instead of bundling, so no runtime ever tries to inline `fs`.
    serverComponentsExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
