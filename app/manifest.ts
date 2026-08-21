import type { MetadataRoute } from "next";
import { BRAND_NAME } from "@/lib/brand";

const BRAND = BRAND_NAME;

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
    theme_color: "#0b1120",
    lang: "uz",
    /**
     * Ikonlar aniq o'lchamlar bilan beriladi.
     *
     * Ilgari bitta `sizes: "any"` yozuv turardi — Android uni istalgan
     * o'lchamga cho'zadi va `maskable` variantsiz belgini o'z shakliga
     * QIRQADI, ya'ni burchaklardagi qismi yo'qoladi. Endi:
     *   — `any`      brauzer/ish stoli uchun (to'liq belgi ko'rinadi);
     *   — `maskable` Android uchun (belgi markazda 66%, fon to'liq).
     */
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
