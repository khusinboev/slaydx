"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeChoice } from "@/components/shell/ThemeToggle";
import type { ProfileStep } from "@/lib/nav/tabs";

export const PROFILE_STEP_TITLES: Record<ProfileStep, string> = {
  shaxsiy: "Shaxsiy ma’lumotlar",
  oqish: "O‘qish",
  ish: "Ish joyi",
  korinish: "Ko‘rinish",
  xavfsizlik: "Xavfsizlik",
};

/**
 * `/uz/profile/<step>` — interim page laid by the shell package (F0): the
 * route, its «←» (back to the profile index) and the step slide-in exist;
 * package W4 builds the real steps. «Ko'rinish» already works (Kun / Tun /
 * Avto); the other steps point to the profile page, where the fields are
 * still edited today.
 */
export function ProfileStepPage({ step }: { step: ProfileStep }) {
  return (
    <div className="slx-step-enter flex w-full flex-col" data-profile-step={step}>
      <PageHeader title={PROFILE_STEP_TITLES[step]} back backFallback="/uz/profile" />
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-6">
        {step === "korinish" ? (
          <section aria-labelledby="theme-label" className="bg-card rounded-[var(--radius-card)] border p-4">
            <h2 id="theme-label" className="mb-3 text-[16px] font-semibold">
              Mavzu
            </h2>
            <ThemeChoice />
            <p className="text-muted-foreground mt-3 text-[13.5px]">«Avto» qurilmangiz sozlamasiga ergashadi.</p>
          </section>
        ) : (
          <div className="bg-card rounded-[var(--radius-card)] border p-4 text-[15.5px]">
            <p>Bu ma’lumotlar hozircha profil sahifasida tahrirlanadi.</p>
            <Link href="/uz/profile" className="text-primary mt-2 inline-flex min-h-11 items-center font-medium">
              Profilga o‘tish
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
