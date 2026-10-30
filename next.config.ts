import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// What the browser loads: the app itself (fonts from next/font are served from it), Supabase
// for auth and data, and on preview deployments only the Vercel toolbar: production allows no
// host it doesn't use, so an injected script has no shared host (Pusher) to send data through.
// Inline scripts and styles are Next's and next-themes'; React needs eval in development only.
// VERCEL_ENV is set when Vercel builds, which is when these headers are made.
const toolbar = (hosts: string) => (process.env.VERCEL_ENV === 'preview' ? ` ${hosts}` : '')
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}${toolbar('https://vercel.live')}`,
  `style-src 'self' 'unsafe-inline'${toolbar('https://vercel.live')}`,
  `img-src 'self' blob: data:${toolbar('https://vercel.live https://vercel.com')}`,
  `font-src 'self' data:${toolbar('https://vercel.live https://assets.vercel.com')}`,
  ["connect-src 'self'", process.env.NEXT_PUBLIC_SUPABASE_URL, toolbar('https://vercel.live wss://ws-us3.pusher.com').trim()].filter(Boolean).join(' '),
  ...(process.env.VERCEL_ENV === 'preview' ? ['frame-src https://vercel.live'] : []),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // The app uses none of these
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Enforced since 2026-10-23, after a week report-only (from 2026-10-15) and a check of every
          // page in a production build. What it still blocks in a signed-in page reaches app_errors
          // (components/CspViolationReporter.tsx), so a host the app needs and the list leaves out alarms.
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      // The service worker (public/sw.js) is checked for a new version on every visit, never from a cache
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig)
