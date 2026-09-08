"use client";

import type { ToolConfig, UserProfile } from "@/lib/types";
import { SlideForm } from "./SlideForm";

/**
 * Pro slayd formasi.
 *
 * WP-0b: STUB — marshrut va narx ishlashi uchun oddiy formaga
 * yo'naltiradi. WP-G haqiqiy formani yozadi: maydonlar FAQAT
 * `lib/generation/slide-params.ts` reyestridan chiziladi (auditoriya 14,
 * taqdimot turi 9, tuzilma bloklari, slayder 4–30, rasm uslubi, logotip,
 * lavozim/tashkilot, asosiy g'oyalar, mahalliy misollar, matn hajmi,
 * test, internet, izohlar). Qamrov testi «reyestrda bor, formada yo'q»
 * ni ushlaydi.
 */
export function ProSlideForm({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  return <SlideForm tool={tool} profile={profile} />;
}
