/**
 * Scripts of the Uzbek converter (owner request 6). Shared by the pure
 * converter, the file converter, the route and the page, so everybody
 * agrees on the ids and the labels.
 *
 *  - `cyr` — Cyrillic;
 *  - `lat` — the CURRENT Latin (1995): `oʻ gʻ sh ch`, `oʻ/gʻ` use U+02BB;
 *  - `new` — the NEW Latin of Law ЎРҚ-1184 (21.10.2026, in force 22.04.2027):
 *            `Ö Ğ Ş Ç`; `ng` stays two letters; tutuq is ʼ (U+02BC).
 */

export type Script = "cyr" | "lat" | "new";

export const SCRIPTS: readonly Script[] = ["cyr", "lat", "new"];

export const SCRIPT_LABEL: Readonly<Record<Script, string>> = {
  cyr: "Kirill",
  lat: "Lotin",
  new: "Yangi lotin",
};

export function isScript(v: unknown): v is Script {
  return v === "cyr" || v === "lat" || v === "new";
}

/** Files the alifbo mode accepts (no LibreOffice needed). */
export const ALIFBO_FILE_EXTENSIONS = ["docx", "pptx", "txt"] as const;
export type AlifboFileKind = (typeof ALIFBO_FILE_EXTENSIONS)[number];

export function alifboKindOfName(fileName: string): AlifboFileKind | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  const e = m ? m[1]!.toLowerCase() : "";
  return (ALIFBO_FILE_EXTENSIONS as readonly string[]).includes(e) ? (e as AlifboFileKind) : null;
}

/** Suffix of the converted file name: `hisobot-lotin.docx`. */
export const SCRIPT_FILE_SUFFIX: Readonly<Record<Script, string>> = {
  cyr: "kirill",
  lat: "lotin",
  new: "yangi-lotin",
};
