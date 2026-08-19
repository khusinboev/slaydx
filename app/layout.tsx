import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Tinos } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BRAND_NAME } from "@/lib/brand";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const tinos = Tinos({
  variable: "--font-tinos",
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

/**
 * Brend nomi env dan keladi — o'z nomingizga o'tish bitta o'zgaruvchi
 * almashtirish bilan cheklanadi: nom, logo va domen o'zingizniki bo'lsin.
 */
const BRAND = BRAND_NAME;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const DESCRIPTION =
  "Sun'iy intellekt yordamida slaydlar, insholar, kurs ishlari va boshqa hujjatlarni bir necha daqiqada yarating";

export const metadata: Metadata = {
  // `metadataBase` bo'lmasa OG rasm havolalari nisbiy qoladi va
  // ijtimoiy tarmoqlarda ko'rinmaydi.
  metadataBase: new URL(APP_URL),
  title: { default: BRAND, template: `%s — ${BRAND}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "uz_UZ",
    siteName: BRAND,
    title: BRAND,
    description: DESCRIPTION,
    url: APP_URL,
  },
  twitter: { card: "summary_large_image", title: BRAND, description: DESCRIPTION },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f7" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} ${tinos.variable} font-sans antialiased`}>
        {/* Klaviatura foydalanuvchilari sidebar ni aylanib o'tishi uchun. */}
        <a
          href="#main"
          className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:px-4 focus:py-2"
        >
          Asosiy qismga o&apos;tish
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
