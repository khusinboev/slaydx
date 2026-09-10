import type { GlossaryEntry } from "./report";

/** Klient (forma hisobi) va dvigatel BITTA parserdan — og'ir importlarsiz. */
export const USER_GLOSSARY_MAX = 100;

/** `atama = tarjima` | `atama — tarjima` | `atama: tarjima` — har qatorda bittadan. */
export function parseUserGlossary(text: unknown): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.+?)\s*(?:=|—|–|:|->|→)\s*(.+)$/);
    if (!m) continue;
    const src = m[1].trim().slice(0, 80);
    const dst = m[2].trim().slice(0, 120);
    if (!src || !dst) continue;
    const key = src.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ src, dst });
    if (out.length >= USER_GLOSSARY_MAX) break;
  }
  return out;
}

