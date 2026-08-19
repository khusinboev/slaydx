import type { MetadataRoute } from "next";

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Sodda.ai";

/** PWA manifesti — telefonda «bosh ekranga qo'shish» ishlashi uchun. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    description:
      "Sun'iy intellekt yordamida slaydlar, insholar va hujjatlarni bir necha daqiqada yarating",
    start_url: "/uz",
    display: "standalone",
    background_color: "#f7f7f7",
    theme_color: "#f7f7f7",
    lang: "uz",
    icons: [{ src: "/logo.png", sizes: "any", type: "image/png" }],
  };
}
