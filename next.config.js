/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Security headers on every response. CSP allows self plus the inline script/style
  // Next.js itself requires; connect-src stays 'self' because analytics is
  // server-side only. HSTS is ignored by browsers over plain http, so it is safe to
  // send unconditionally (the tailnet/mini deployment is unaffected).
  async headers() {
    // Dev-only relaxations: webpack's eval sourcemaps need 'unsafe-eval', and hot
    // reload runs over a websocket. Production stays strict.
    const dev = process.env.NODE_ENV === 'development';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // Chrome applies form-action to redirects that follow a form POST, so the
      // OAuth consent redirect targets must be listed (claude.ai for hosted Claude,
      // loopback for Claude Code's RFC 8252 flow).
      "form-action 'self' https://claude.ai http://localhost:* http://127.0.0.1:*",
      "object-src 'none'",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
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
