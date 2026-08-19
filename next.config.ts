import type { NextConfig } from "next";

/**
 * Xavfsizlik sarlavhalari.
 *
 * Ilgari hech qanday sarlavha o'rnatilmasdi: sayt boshqa domendagi
 * iframe ga joylashtirilishi (clickjacking), MIME sniffing va referrer
 * sizib chiqishi mumkin edi.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `X-Frame-Options` ataylab YO'Q.
  //
  // U faqat bitta qiymatni qabul qiladi (`SAMEORIGIN`) va ro'yxatni
  // qo'llab-quvvatlamaydi, shuning uchun u Telegram Mini App ni
  // (u bizni `web.telegram.org` iframe ida ochadi) butunlay bloklardi.
  // O'rniga CSP `frame-ancestors` ishlatiladi — u ham zamonaviy
  // brauzerlarda XFO dan ustun turadi.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Boshqa sayt bizning javoblarimizni resurs sifatida o'qiy olmasin.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inline runtime skriptlaridan foydalanadi. Nonce ga
      // o'tish uchun middleware kerak — kelajakdagi yaxshilanish.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' data: blob:",
      "worker-src 'self' blob:",
      "frame-src https://telegram.org https://oauth.telegram.org",
      "frame-ancestors 'self' https://web.telegram.org https://telegram.org https://k.telegram.org https://z.telegram.org https://a.telegram.org",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://my.click.uz https://checkout.paycom.uz",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "pg"],
  poweredByHeader: false,
  // Konteynerda ishlash uchun minimal server to'plami.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
      {
        // API javoblari shaxsiy — proxy yoki CDN keshlamasin.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
