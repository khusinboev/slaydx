import { redirect } from "next/navigation";

/**
 * `studio-dub` is a chip of the Studio's «Audio» tab (docs/studio/P10-SPEC.md), not a page of its own: links to the
 * tool's slug (a result page's «Qayta», a bot link) land on the tab.
 */
export default function Page() {
  redirect("/uz/studio?tab=audio");
}
