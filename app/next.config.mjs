// `output: "standalone"` is required for Docker/SPCS deployment.
// `images.unoptimized` avoids needing the sharp package.
//
// `turbopack.root` and `outputFileTracingRoot` are pinned to this app's
// own directory because Next.js 16 + Turbopack walks upward looking for
// a lockfile and silently re-roots the project if it finds one in a
// parent directory. Symptoms when this re-roots are nasty: `/` returns
// 404, chunk URLs contain the wrong path prefix, and
// `outputFileTracingRoot` is wrong at deploy time. Keeping these
// pinned to `__dirname` is the only reliable fix; do NOT remove them
// when adding new config.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  // TypeScript errors are reported at build time — do not suppress them.
  // If build is blocked by a legitimate error, fix it rather than ignoring it.
  images: {
    unoptimized: true,
  },

  // Security headers — applied to all responses
  async headers() {
    // CSP: allow same-origin scripts/styles; connect only to Snowflake APIs.
    // 'unsafe-inline' for BOTH scripts and styles is required:
    //   - scripts: Next.js App Router inlines RSC payloads as <script> tags at runtime;
    //              without 'unsafe-inline' hydration breaks silently in all browsers.
    //   - styles: Tailwind CSS v4 generates inline styles.
    // 'unsafe-eval' is intentionally excluded in production — it is only needed
    // for HMR in local development. SPCS deployments do not need it.
    const isDev = process.env.NODE_ENV === "development"
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "worker-src 'self' blob:",
      "connect-src 'self' *.snowflakecomputing.com *.amazonaws.com",
      "frame-src 'self' blob: https://*.amazonaws.com https://*.snowflakecomputing.com",
      "frame-ancestors 'none'",
      "object-src 'self' https://*.amazonaws.com https://*.snowflakecomputing.com",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")

    return [
      {
        source: "/(.*)",
        headers: [
          // Primary XSS defense
          { key: "Content-Security-Policy",    value: csp },
          // Prevent clickjacking (belt-and-suspenders alongside CSP frame-ancestors)
          { key: "X-Frame-Options",            value: "DENY" },
          // Prevent MIME-type sniffing
          { key: "X-Content-Type-Options",     value: "nosniff" },
          // Disable legacy XSS filter (CSP supersedes it)
          { key: "X-XSS-Protection",           value: "0" },
          // Don't leak origin URL to third-party requests
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          // Disable hardware access APIs not needed by this app
          { key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          // HSTS — SPCS always serves HTTPS; enforce for 1 year
          { key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Cache static assets aggressively (Next.js content-hashes them)
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Never cache API responses — data changes frequently
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ]
  },
}

export default nextConfig
