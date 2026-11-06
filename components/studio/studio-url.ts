import { AUDIO_MODES } from "@/lib/media/catalog-audio";
import { SPEECH_TOOL_MODES } from "@/lib/media/catalog-transcribe";
import { TOOL_MODES } from "./studio-modes";

/** The Studio's media tabs (P1 «Rasm», P3 «Video», P5 «Ovoz», P6 «Audio»). */
export type StudioTab = "rasm" | "video" | "ovoz" | "audio";
export const STUDIO_TABS: readonly StudioTab[] = ["rasm", "video", "ovoz", "audio"];

/** The tab a link asks for (`/uz/studio?tab=video`, where `/uz/studio-video` redirects; `?tab=ovoz`); anything else = «Rasm». */
export function tabFromSearch(search: string): StudioTab {
  const t = new URLSearchParams(search).get("tab");
  return t === "video" ? "video" : t === "ovoz" ? "ovoz" : t === "audio" ? "audio" : "rasm";
}

/** What `?mode=` may say on each tab (the audio chips: the catalog's modes, the P10 tools, «Montaj»). */
const TAB_MODES: Readonly<Record<StudioTab, readonly string[]>> = {
  rasm: ["image", ...TOOL_MODES],
  video: ["effects", "text"],
  ovoz: ["text", "dialogue"],
  audio: [...AUDIO_MODES.map((m) => m.mode), ...SPEECH_TOOL_MODES.map((m) => m.mode), "mix"],
};

/** The mode a link asks for on `tab`, `null` when it names none that tab has. */
export function modeFromSearch(tab: StudioTab, search: string): string | null {
  const m = new URLSearchParams(search).get("mode");
  return m !== null && TAB_MODES[tab].includes(m) ? m : null;
}

/** `search` with the tab and mode on screen; other params (a voice template, a bot link) stay. The defaults are left out. */
export function studioSearch(search: string, tab: StudioTab, mode: string | null): string {
  const q = new URLSearchParams(search);
  if (tab === "rasm") q.delete("tab");
  else q.set("tab", tab);
  if (mode === null || (tab === "rasm" && mode === "image")) q.delete("mode");
  else q.set("mode", mode);
  const s = q.toString();
  return s ? `?${s}` : "";
}
