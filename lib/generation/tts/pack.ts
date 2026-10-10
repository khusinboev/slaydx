/**
 * Provider-aware request packing.
 *
 * The audio engine hands the chain one part per script line (each ≤ 900 chars, sized
 * for Aisha's 1 000-char limit). That is right for Azure/Aisha but wasteful for
 * Gemini, whose binding limit is a per-minute REQUEST quota (≈10/min/project/model):
 * a 1-minute greeting became 11 calls. `packParts` merges consecutive parts into
 * requests of up to `ttsChunkLimit(provider)` chars (Gemini 2 400), never splitting a
 * part (sentence/turn boundaries stay intact):
 *
 *   - same voice            → texts joined with a space (one request, one voice);
 *   - two voices + a provider with `multiSpeaker` (Gemini) → consecutive turns of BOTH
 *     speakers in one request (`turns`), so a podcast needs 2–4 calls, not one per turn;
 *   - two voices, no multi-speaker → a request holds consecutive turns of ONE speaker.
 *
 * A provider whose limit equals `TTS_LIMITS.chunkChars` (Azure, Aisha) is NOT packed:
 * one call per part, exactly as before. Pure function, no I/O.
 */
import { TTS_LIMITS, ttsChunkLimit, type TtsProviderId } from "./types";

export type PackPart = { text: string; voice?: number; pauseMs?: number };

/** One provider request: `voice` is the role (0 = A, 1 = B) of a single-speaker call. */
export type TtsCall = {
  text: string;
  voice: number;
  /** Present only for a two-speaker request (both roles occur). */
  turns?: { voice: number; text: string }[];
  /** Pause after the request = the last packed part's pause (only Azure reads it, and Azure is not packed). */
  pauseMs?: number;
};

/** Speaker labels of a multi-speaker request; the Gemini adapter's `speakerVoiceConfigs` use the same names. */
export const DIALOG_LABELS = ["Speaker1", "Speaker2"] as const;

/** Dialog as the model reads it: `Speaker1: …\nSpeaker2: …`. */
export function renderDialog(turns: readonly { voice: number; text: string }[]): string {
  return turns.map((t) => `${DIALOG_LABELS[t.voice === 1 ? 1 : 0]}: ${t.text}`).join("\n");
}

const roleOf = (p: PackPart): number => (p.voice === 1 ? 1 : 0);

/** Consecutive parts of one role → one turn. */
function turnsOf(parts: readonly PackPart[], role: (p: PackPart) => number): { voice: number; text: string }[] {
  const turns: { voice: number; text: string }[] = [];
  for (const p of parts) {
    const text = p.text.trim();
    const last = turns[turns.length - 1];
    if (last && last.voice === role(p)) last.text = `${last.text} ${text}`;
    else turns.push({ voice: role(p), text });
  }
  return turns;
}

function build(parts: readonly PackPart[], multi: boolean, role: (p: PackPart) => number): { call: TtsCall; size: number } {
  const turns = turnsOf(parts, role);
  const last = parts[parts.length - 1];
  const pause = last.pauseMs !== undefined ? { pauseMs: last.pauseMs } : {};
  if (multi && turns.length > 0 && turns.some((t) => t.voice !== turns[0].voice)) {
    return { call: { text: turns.map((t) => t.text).join(" "), voice: turns[0].voice, turns, ...pause }, size: renderDialog(turns).length };
  }
  const text = parts.map((p) => p.text.trim()).join(" ");
  return { call: { text, voice: role(parts[0]), ...pause }, size: text.length };
}

/**
 * `twoVoices` — the group really has two DIFFERENT voices; with one voice the roles
 * collapse (everything is read in it) and packing never has to alternate.
 */
export function packParts(parts: readonly PackPart[], o: { provider: TtsProviderId; multiSpeaker?: boolean; twoVoices?: boolean }): TtsCall[] {
  const live = parts.filter((p) => String(p.text ?? "").trim());
  const limit = ttsChunkLimit(o.provider);
  const role = o.twoVoices === false ? () => 0 : roleOf;

  if (limit <= TTS_LIMITS.chunkChars) {
    // Not packed: one request per part (contract unchanged for Azure/Aisha).
    return live.map((p) => ({ text: p.text.trim(), voice: roleOf(p), ...(p.pauseMs !== undefined ? { pauseMs: p.pauseMs } : {}) }));
  }

  const multi = Boolean(o.multiSpeaker) && o.twoVoices !== false;
  const out: TtsCall[] = [];
  let cur: PackPart[] = [];
  for (const p of live) {
    if (!cur.length) {
      cur = [p];
      continue;
    }
    const sameRole = role(p) === role(cur[0]) && cur.every((c) => role(c) === role(p));
    const next = [...cur, p];
    const fits = (multi || sameRole) && build(next, multi, role).size <= limit;
    if (fits) cur = next;
    else {
      out.push(build(cur, multi, role).call);
      cur = [p];
    }
  }
  if (cur.length) out.push(build(cur, multi, role).call);
  return out;
}
