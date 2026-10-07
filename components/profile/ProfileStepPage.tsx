"use client";

import { useRouter } from "next/navigation";
import { backToPath } from "@/lib/nav/history";
import type { ProfileStep as ProfileStepRoute } from "@/lib/nav/tabs";
import { ProfileStep } from "./ProfileStep";
import { profileHref, type ProfileTarget } from "./profile-model";

/**
 * `/uz/profile/<step>`: the W4 step screen (it carries its own «←» header,
 * hidden while Telegram's BackButton is shown) with real routes behind
 * `onNavigate`, so the phone / Telegram / trackpad back walks the same path:
 * the next step is pushed; «home» («←», «Saqlash va yakunlash», logout)
 * returns to the profile index with every step above it out of the history
 * (`backToPath`: back to the nearest index entry in one `history.go(-n)`, so
 * back from the index then goes to Bosh, never into the steps).
 */
export function ProfileStepPage({ step }: { step: ProfileStepRoute }) {
  const router = useRouter();
  const go = (to: ProfileTarget) => {
    if (to === "home") void backToPath(profileHref("home"), { router });
    else router.push(profileHref(to));
  };
  return (
    <div className="slx-step-enter flex w-full flex-col" data-profile-step={step}>
      <ProfileStep step={step} onNavigate={go} />
    </div>
  );
}
