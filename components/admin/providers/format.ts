import type { ProviderItem, ProviderKind } from "@/lib/admin-api/providers";

/** Uzbek names of the provider kinds. */
export const KIND_LABEL: Readonly<Record<ProviderKind, string>> = {
  llm: "Matn (LLM)",
  image: "Rasm",
  tts: "Ovoz",
  video: "Video",
  research: "Manbalar",
};

/** What a change needs to reach the other process (web <-> worker). */
export function propagationNote(sec: number): string {
  return `O'zgarish boshqa jarayonlarga (veb va worker) ${sec} soniyagacha yetib boradi.`;
}

export type KeyState = { tone: "success" | "info" | "warning" | "neutral"; label: string };

/**
 * The key column: «Bazada …a1B2» (stored, masked), «Env» (only the environment variable), «Yo'q».
 * A stored key that cannot be decrypted is called out: the environment applies until it is entered again.
 */
export function keyState(item: ProviderItem): KeyState {
  if (item.hasDbKey && item.unreadable) {
    return { tone: "warning", label: item.envPresent ? "Bazadagi kalit o'qilmaydi · Env ishlatiladi" : "Bazadagi kalit o'qilmaydi" };
  }
  if (item.hasDbKey) return { tone: "success", label: item.keyHint ? `Bazada ${item.keyHint}` : "Bazada" };
  if (item.envPresent) return { tone: "info", label: "Env" };
  return { tone: "neutral", label: "Yo'q" };
}
