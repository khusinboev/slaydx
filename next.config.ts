import type { NextConfig } from "next";

/**
 * Xavfsizlik sarlavhalari.
 *
 * Ilgari hech qanday sarlavha o'rnatilmasdi: sayt boshqa domendagi
 * iframe ga joylashtirilishi (clickjacking), MIME sniffing va referrer
 * sizib chiqishi mumkin edi.
 */
const isProd = process.env.NODE_ENV === "production";

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
      /*
       * `unsafe-eval` FAQAT ishlab chiqishda.
       *
       * Uni dev'da Turbopack talab qiladi (HMR modullarni `eval` bilan
       * yuklaydi), prod to'plamida esa kerak emas. Ilgari ikkala muhitda
       * ham turardi — ya'ni prodda bekorga ochiq edi.
       *
       * `unsafe-inline` qoladi va bu ONGLI qaror: undan qutulish uchun
       * har so'rovga nonce qo'yuvchi middleware kerak, nonce esa
       * OLDINDAN chizilgan sahifalar bilan mos kelmaydi — build chiqishi
       * bo'yicha saytda SSG (`/uz/[slug]`, 14 yo'l) va statik sahifalar
       * bor. Nonce ularning HTML'iga kirib ulgurmaydi va skriptlar
       * bloklanadi, ya'ni sayt ishlamay qoladi. Almashuv arzimaydi.
       */
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} https://telegram.org`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' data: blob:",
      "worker-src 'self' blob:",
      /*
       * `'self'` — sayt O'Z faylini iframe'da ko'rsatishi uchun (Tarjimon 2
       * «Fayl» tabi: `/api/generations/{id}/file?format=pdf&inline=1`).
       * Ilgari faqat Telegram domenlari bor edi va brauzer o'z PDF'imizni
       * «content blocked» deb to'sardi — AUDIT-14 smoke buni ko'rmagan,
       * chunki headless Chromium iframe ichida PDF chizmaydi.
       */
      "frame-src 'self' https://telegram.org https://oauth.telegram.org",
      "frame-ancestors 'self' https://web.telegram.org https://telegram.org https://k.telegram.org https://z.telegram.org https://a.telegram.org",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://my.click.uz https://checkout.paycom.uz",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

/*
 * Admin panel CSP (docs/admin/02-plan.md §10 T17): the panel must not be
 * framable, not even by Telegram. Next does not send a second header for the
 * same key — a later matching rule OVERWRITES the earlier value
 * (`resolve-routes.js`: `resHeaders[key] = value`). A bare
 * `frame-ancestors 'none'` rule would therefore replace the site CSP on admin
 * paths and drop `script-src`, `object-src`, … So the admin value is the site
 * CSP with only `frame-ancestors` tightened to 'none' (strictly stronger).
 */
const SITE_CSP = securityHeaders.find((h) => h.key === "Content-Security-Policy")!.value;
const ADMIN_CSP = SITE_CSP.split("; ")
  .map((d) => (d.startsWith("frame-ancestors ") ? "frame-ancestors 'none'" : d))
  .join("; ");
const adminHeaders = [
  { key: "Content-Security-Policy", value: ADMIN_CSP },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/**
 * O'z `Cache-Control` ini qo'yadigan bayt route'lari (`/api/` dan keyingi
 * qism, regex): slayd/rasm aktivlari va ochiq tinglash audiosi (id —
 * kontent hashi), rezyume surati (kontent hashi), eskiz (faqat `?v=` bilan
 * keshlanadi, pastdagi alohida qoida). Ro'yxatni kengaytirganda route
 * ham `noStoreOnError` bilan o'ralishi SHART.
 */
const BYTE_ROUTES = [
  "generations/[^/]+/assets/[^/]+",
  "generations/[^/]+/thumb",
  "o/[^/]+/audio/[^/]+",
  "uploads/photo/[^/]+",
].join("|");

const nextConfig: NextConfig = {
  // `sharp` — Maqola 2 sxemalari (SVG → PNG 300 dpi) worker/server tomonda;
  // Next uni bundlega tortmasin (nativ modul).
  serverExternalPackages: ["unpdf", "pg", "sharp"],
  poweredByHeader: false,
  /*
   * Next rasm optimizatorini o'chiramiz.
   *
   * `next/image` loyihada umuman ishlatilmaydi (grep bo'sh) — rasmlar
   * `<img>` orqali beriladi. Optimizator esa `sharp` ni tortadi, unda
   * `libvips` orqali kelgan 4 ta ochiq CVE bor (GHSA-f88m-g3jw-g9cj) va
   * ular faqat Next 16 ga o'tish bilan yopiladi. Optimizator o'chirilsa
   * `/_next/image` hech qanday tasvirni qayta ishlamaydi, ya'ni zaif
   * kod yo'liga umuman kirilmaydi.
   */
  images: { unoptimized: true },
  // Konteynerda ishlash uchun minimal server to'plami.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  /*
   * File tracing (docs/ops/O1-deploy-pipeline.md F4). `process.cwd()`-based
   * reads (`lib/server/db.ts` migrations, `lib/server/admin-system.ts`
   * package.json) defeat nft, so every route's trace listed the WHOLE project
   * tree and `standalone/` shipped sources, tests and load tests. None of
   * these are read at run time: components/scripts are compiled into the
   * server chunks, the migrations are copied by the Dockerfile on their own.
   * `lib/`, `app/`, `data/`, `public/` and `package.json` stay traced (runtime
   * reads). `tests/next-config-ops.test.mts` locks the list.
   */
  outputFileTracingExcludes: {
    "*": [
      "tests/**",
      "loadtests/**",
      "eval-out/**",
      "audit/**",
      "docs/**",
      "scratch-tmp/**",
      "namunalar/**",
      ".claude/**",
      ".github/**",
      "deploy/**",
      "brand/**",
      "scripts/**",
      "components/**",
      "*.md",
    ],
  },

  /*
   * `/` → `/uz` on the server (docs/ops/O4-frontend-speed.md WP-G, item 11).
   * `app/page.tsx` redirects with `redirect()`, but the page is prerendered,
   * so the redirect happened in the browser AFTER the whole ~200 kB root
   * bundle loaded — on every launch through a bare `/` link (an old
   * BotFather menu URL, a typed address). A config redirect is a plain 307
   * before any page work. Temporary (not 308): browsers must not cache it,
   * the landing locale may change. Next keeps the query string and the
   * browser keeps the `#tgWebAppData` fragment, so Mini App launch data
   * survives the hop.
   */
  async redirects() {
    return [{ source: "/", destination: "/uz", permanent: false }];
  },

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
        /*
         * API javoblari shaxsiy — proxy yoki CDN keshlamasin.
         *
         * BAYT route'lari (`BYTE_ROUTES`) bundan ISTISNO: Next konfiguratsiya
         * sarlavhasini route'ning o'z sarlavhasi USTIDAN yozadi, ya'ni bu
         * qoida ularning `max-age … immutable` sini yutib yuborardi va har
         * ko'rishda rasm/surat/audio Postgres'dan qayta o'qilardi
         * (prod-readiness C08: SCALE-01, BEA-07, FE-05). Ular kesh
         * sarlavhasini o'zi qo'yadi, xatoda esa `private, no-store`
         * (`lib/server/http-bytes.ts` `noStoreOnError`).
         * `tests/cache-headers.test.mts` Next'ning o'z moslashtiruvchisi bilan tekshiradi.
         */
        source: `/api/:path((?!(?:${BYTE_ROUTES})$).*)`,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        /*
         * Eskiz aktiv id si doimiy (`THUMB_ASSET_ID`) — URL tahrirdan keyin
         * o'zgarmaydi. Versiyasiz so'rov (`?v=<fileVersion>` yo'q) keshlanmaydi,
         * aks holda brauzer bir kun eski eskizni ko'rsatardi.
         */
        source: "/api/generations/:id/thumb",
        missing: [{ type: "query", key: "v" }],
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        /*
         * Fayl javobi (DOCX/PPTX bayt yoki PDF ko'rinishi) — hujjat, sahifa
         * emas: sayt CSP'si (`default-src 'self'`, `object-src 'none'`) unga
         * kerak emas va Chrome'ning PDF ko'ruvchisiga halaqit berishi mumkin.
         * Konfiguratsiya sarlavhalari marshrut o'zi qo'ygan sarlavhani
         * USTIDAN yozadi (prodda `thumb` ning o'z CSP'si yo'qolgani shundan),
         * shuning uchun istisno ham shu yerda, marshrutda emas. Faqat
         * `frame-ancestors 'self'` qoladi — faylni boshqa sayt iframe qila olmaydi.
         */
        source: "/api/generations/:id/file",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        /*
         * Signed download URL (docs/mobile/PLAN.md §4.2): a bearer link the
         * Telegram client fetches without our cookie. Config headers overwrite
         * the route's own, so the values that differ from the site rules live
         * here: the token in the path must never leak through `Referer`;
         * Telegram Web reads the file cross-origin (CORP `same-origin` would
         * block a no-cors read); the file is not a page (no scripts, not
         * framable, not indexed). `Cache-Control: private, no-store` comes
         * from the `/api/` rule; the route adds `Access-Control-Allow-Origin`.
         * `tests/download-routes.test.mts` checks the merged result.
         */
        source: "/api/dl/:token",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      /*
       * Admin panel and API (§10 T16, T17): not framable, not indexed, and
       * pages are never stored by a browser or proxy cache. Listed last so
       * these values win over the site-wide rules above. `/api/admin` keeps
       * `private, no-store` from the `/api/` rule.
       */
      {
        source: "/admin/:path*",
        headers: [...adminHeaders, { key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/admin/:path*",
        headers: adminHeaders,
      },
    ];
  },
};

export default nextConfig;
