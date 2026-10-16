import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// What the browser loads: the app itself (fonts from next/font are served from it), Supabase
// for auth and data, and the Vercel toolbar on preview deployments. Inline scripts and styles
// are Next's and next-themes'; React needs eval in development only.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://vercel.live`,
  "style-src 'self' 'unsafe-inline' https://vercel.live",
  "img-src 'self' blob: data: https://vercel.live https://vercel.com",
  "font-src 'self' data: https://vercel.live https://assets.vercel.com",
  ["connect-src 'self'", process.env.NEXT_PUBLIC_SUPABASE_URL, 'https://vercel.live wss://ws-us3.pusher.com'].filter(Boolean).join(' '),
  'frame-src https://vercel.live',
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
          // Report-only for now, so it can't break the site: violations show in the browser's
          // console. To be enforced (as Content-Security-Policy) once a while of use shows none.
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig)
