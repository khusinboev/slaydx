import { notFound } from "next/navigation";
import { ProfileStepPage } from "@/components/profile/ProfileStepPage";
import { isProfileStep } from "@/lib/nav/tabs";

/** `/uz/profile/<step>`: `shaxsiy | oqish | ish | korinish | xavfsizlik`; anything else is a 404. */
export default async function Page({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!isProfileStep(step)) notFound();
  return <ProfileStepPage step={step} />;
}
