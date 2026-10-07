import { redirect } from "next/navigation";
import { walletRedirectTarget } from "@/lib/nav/tabs";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Legacy route: the wallet moved to `/uz/wallet` (docs/redesign/PLAN.md). A
 * server redirect that keeps the query, so the payment provider's return URL
 * (`/uz/purchase?order=<id>`) and old links keep working.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  redirect(walletRedirectTarget(await searchParams));
}
