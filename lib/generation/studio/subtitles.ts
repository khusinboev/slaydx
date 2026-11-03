/**
 * Studio P10 «Transkripsiya» — subtitles from ElevenLabs Speech-to-Text word timestamps (docs/studio/P10-SPEC.md). Pure,
 * client-safe: the engine stores the cues in `doc.transcribe`, and the SRT / VTT downloads, the burn file and the viewer
 * are all built from those SAME cues («ko'rdim = oldim»).
 *
 * Cue rules (common subtitle practice, Netflix / BBC style guides):
 *   - at most 2 lines of at most 42 characters (word-wrapped; a single longer word gets its own line, never cut);
 *   - at most 6 s on screen;
 *   - a new cue after a pause of 1 s, after a sentence end (when the cue already holds ≥ 1.5 s), and — with speaker labels
 *     on — when the speaker changes; the label («1:», «2:») is part of the first line and counts toward its length;
 *   - a cue is at least 0.7 s long unless the next one starts earlier; cues never overlap.
 * Text is never rewritten: Uzbek apostrophes (oʻ gʻ o‘ o’ o') and every other character pass through as the provider wrote
 * them. Only the formats' own syntax is escaped: VTT `& < >`; the burn copy also neutralises libass override braces.
 */

/** One `words[]` item of the Speech-to-Text answer (`type`: word | spacing | audio_event). */
export type SttWord = { text: string; start: number; end: number; type?: string; speaker_id?: string | null };
export type Cue = { start: number; end: number; lines: string[]; speaker: number | null };

export const CUE_MAX_CHARS = 42;
export const CUE_MAX_LINES = 2;
export const CUE_MAX_SECONDS = 6;
export const CUE_PAUSE_SECONDS = 1;
export const CUE_MIN_SECONDS = 0.7;
const SENTENCE_MIN_SECONDS = 1.5;

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const ms = (s: number): number => Math.round(s * 1000) / 1000;

/** Greedy word wrap into lines of ≤ `max` characters; a word longer than `max` stands alone on its line. */
export function wrapWords(words: readonly string[], max = CUE_MAX_CHARS): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Spoken words in order, cleaned; spacing / audio events / empty items dropped; times made sane (end ≥ start). */
export function spokenWords(words: readonly SttWord[]): { text: string; start: number; end: number; speaker: string | null }[] {
  const out: { text: string; start: number; end: number; speaker: string | null }[] = [];
  for (const w of words) {
    if (!w || (w.type && w.type !== "word")) continue;
    const text = clean(String(w.text ?? ""));
    if (!text) continue;
    const start = num(w.start);
    out.push({ text, start, end: Math.max(start, num(w.end)), speaker: typeof w.speaker_id === "string" && w.speaker_id ? w.speaker_id : null });
  }
  return out;
}

/** Speaker ids → 1, 2, … in order of appearance. */
function speakerNumbers(words: readonly { speaker: string | null }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of words) if (w.speaker && !map.has(w.speaker)) map.set(w.speaker, map.size + 1);
  return map;
}

const endsSentence = (t: string): boolean => /[.!?…]["»”’)]*$/.test(t);

/** The cues of a transcript (rules in the file header). `speakers` = label each cue with its speaker's number. */
export function buildCues(words: readonly SttWord[], o: { speakers: boolean }): Cue[] {
  const list = spokenWords(words);
  const nums = speakerNumbers(list);
  const cues: Cue[] = [];
  let cur: { start: number; end: number; words: string[]; speaker: number | null } | null = null;
  const flush = () => {
    if (!cur) return;
    cues.push({ start: cur.start, end: Math.max(cur.end, cur.start + CUE_MIN_SECONDS), lines: wrapWords(cur.words), speaker: cur.speaker });
    cur = null;
  };
  for (const w of list) {
    const speaker = o.speakers && w.speaker ? (nums.get(w.speaker) ?? null) : null;
    if (cur) {
      const c: { start: number; end: number; words: string[]; speaker: number | null } = cur;
      const last = c.words[c.words.length - 1]!;
      const split =
        (o.speakers && speaker !== c.speaker) ||
        w.start - c.end > CUE_PAUSE_SECONDS ||
        w.end - c.start > CUE_MAX_SECONDS ||
        wrapWords([...c.words, w.text]).length > CUE_MAX_LINES ||
        (endsSentence(last) && c.end - c.start >= SENTENCE_MIN_SECONDS);
      if (split) flush();
    }
    if (!cur) cur = { start: w.start, end: w.end, words: speaker !== null ? [`${speaker}:`, w.text] : [w.text], speaker };
    else {
      cur.words.push(w.text);
      cur.end = Math.max(cur.end, w.end);
    }
  }
  flush();
  // No overlap: a cue ends where the next one starts (its minimum length gives way).
  for (let i = 0; i < cues.length - 1; i++) if (cues[i]!.end > cues[i + 1]!.start) cues[i]!.end = Math.max(cues[i]!.start, cues[i + 1]!.start);
  return cues.map((c) => ({ ...c, start: ms(c.start), end: ms(c.end) }));
}

function stamp(seconds: number, sep: "," | "."): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const r = total % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

/** `HH:MM:SS,mmm`. */
export const srtTime = (s: number): string => stamp(s, ",");
/** `HH:MM:SS.mmm`. */
export const vttTime = (s: number): string => stamp(s, ".");

/** libass reads `{…}` as override tags and `\N` / `\h` as escapes: the burn copy shows them as plain text instead. */
const burnSafe = (t: string): string => t.replace(/\{/g, "(").replace(/\}/g, ")").replace(/\\/g, "/");

/** SubRip text. `forBurn`: the copy handed to ffmpeg's `subtitles` filter (libass syntax neutralised). */
export function toSrt(cues: readonly Cue[], o: { forBurn?: boolean } = {}): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.map((l) => (o.forBurn ? burnSafe(l) : l)).join("\n")}\n`)
    .join("\n");
}

const vttSafe = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** WebVTT text. */
export function toVtt(cues: readonly Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.lines.map(vttSafe).join("\n")}\n`).join("\n")}`;
}

/**
 * The readable transcript: with speaker labels, one paragraph per speaker turn («1: …»); without, the provider's own
 * `text` (its punctuation and spacing), else the words joined.
 */
export function transcriptOf(words: readonly SttWord[], text: string, o: { speakers: boolean }): string {
  const list = spokenWords(words);
  if (o.speakers && list.some((w) => w.speaker)) {
    const nums = speakerNumbers(list);
    const turns: { n: number | null; words: string[] }[] = [];
    for (const w of list) {
      const n = w.speaker ? (nums.get(w.speaker) ?? null) : null;
      const last = turns[turns.length - 1];
      if (last && last.n === n) last.words.push(w.text);
      else turns.push({ n, words: [w.text] });
    }
    return turns.map((t) => (t.n !== null ? `${t.n}: ${t.words.join(" ")}` : t.words.join(" "))).join("\n\n");
  }
  const own = String(text ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim();
  return own || list.map((w) => w.text).join(" ");
}
