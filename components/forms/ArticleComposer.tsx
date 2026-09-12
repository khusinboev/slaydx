"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { suggestUdk, updateProfile, type ServerUser } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { profilePatchFrom } from "@/lib/profile-sync";
import { priceFor, formatTanga, ARTICLE_PRICES } from "@/lib/tools";
import {
  ARTICLE_LIMITS,
  CITE_STYLES,
  SELECTABLE_FIGURE_KINDS,
  maxFiguresFor,
  type ArticleAuthor,
  type ArticleTypeId,
  type CiteStyle,
  type PagesId,
  type PublicationProfileId,
  type SelectableFigureKind,
} from "@/lib/generation/article/types";
import { ARTICLE_TYPES } from "@/lib/generation/article/types-registry";
import { PUBLICATION_PROFILES } from "@/lib/generation/article/profiles";
import { estimateArticlePages, pagesUpper } from "@/lib/generation/article/plan";
import {
  ARTICLE_INPUT_LIMITS,
  articleInputFromValues,
  encodeArticleValues,
  normalizeArticlePages,
  type ArticleInput,
  type ArticleUserData,
  type ArticleUserRef,
} from "@/lib/generation/article/input";
import { Card, Row, Segmented, SelectField, Switch, SummaryChips } from "./compact";
import { TextArea, TextInput } from "./fields";
import { Combobox } from "./Combobox";
import { RowList } from "./RowList";
import { SourceFileField } from "./SourceFileField";
import { ArticleTypeTile } from "./ArticleTypeGallery";
import { PublicationProfileTile } from "./PublicationProfileDialog";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * Maqola formasi (Maqola 2 / AUDIT-17, WP6) — `ResumeComposer` uslubida
 * ixcham kartalar, bitta sahifa, qoralama serverda (`useFormDraft`).
 *
 * Reyestr shartnomasi: `lib/generation/article-params.ts` dagi HAR
 * `ARTICLE_PARAMS.id` shu yerda `data-field={id}` bilan chizilgan bo'lishi
 * SHART (`tests/viewer/article-form.test.mts` qamrov testi) — «bezak
 * maydon yo'q» qoidasi. `sourceText`/`fileName` reyestrda YO'Q (fayl
 * matni — ixtiyoriy kontekst, `article/engine.ts` `meta.sourceText ||
 * values.sourceText` orqali o'qiydi), shuning uchun ular `data-field`
 * BILAN BELGILANMAYDI — aks holda "reyestrda yo'q maydon" testi qizarardi.
 */

type UserRefRow = { mode: "doi" | "text"; doi: string; raw: string };

type Ui = {
  topic: string;
  articleType: ArticleTypeId;
  pubProfile: PublicationProfileId;
  /** Foydalanuvchi profilni QO'LDA tanlagan bo'lsa, tur almashganda ustidan yozilmaydi. */
  pubProfileTouched: boolean;
  citeStyle: CiteStyle | "";
  language: "uz" | "ru" | "en";
  pages: PagesId;
  authors: ArticleAuthor[];
  udk: string;
  keywords: string[];
  userFacts: string;
  userRefs: UserRefRow[];
  /** Xom CSV matni — `parseCsvUserData` yuborishdan oldin obyektga aylantiradi. */
  userDataCsv: string;
  figureCount: number;
  /** «Sxema turlari» — bo'sh = avtomatik (AUDIT-18 Q-6). */
  figureKinds: SelectableFigureKind[];
  research: boolean;
  extra: string;
  fileName: string;
  sourceText: string;
};

/** Sxema turi yorliqlari (forma chips) — tartib `SELECTABLE_FIGURE_KINDS` bilan bir xil. */
export const FIGURE_KIND_LABEL: Record<SelectableFigureKind, string> = {
  flow: "Blok-sxema",
  process: "Jarayon",
  tree: "Daraxt",
  layers: "Qatlamlar",
  cycle: "Sikl",
  timeline: "Vaqt chizig‘i",
  matrix: "Matritsa",
  compare: "Taqqoslash",
};

/**
 * «Sxema turlari» chips: «Avto» (bo'sh ro'yxat — model mazmunga qarab
 * tanlaydi) + 8 tur, ko'p tanlov. Sxema so'ralmagan (`figureCount === 0`)
 * bo'lsa o'chiq — tanlov hech narsaga ta'sir qilmaydi (UI testi: `disabled`
 * bog'lanishi olib tashlansa qizaradi).
 */
function FigureKindChips({ value, onChange, disabled }: { value: SelectableFigureKind[]; onChange: (v: SelectableFigureKind[]) => void; disabled: boolean }) {
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sxema turlari">
      <button type="button" aria-pressed={value.length === 0} disabled={disabled} onClick={() => onChange([])} className={chip(value.length === 0)}>
        Avto
      </button>
      {SELECTABLE_FIGURE_KINDS.map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            data-kind={k}
            onClick={() => onChange(on ? value.filter((v) => v !== k) : [...value, k])}
            className={chip(on)}
          >
            {FIGURE_KIND_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}

const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbek" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

const PAGE_LABEL: Record<PagesId, string> = {
  "1-2": "1–2 bet",
  "3-5": "3–5 bet",
  "5-10": "5–10 bet",
  "10-15": "10–15 bet",
};

const CITE_STYLE_LABEL: Record<CiteStyle, string> = {
  gost: "GOST — [1; 25-b.]",
  numeric: "Raqamli — [1]",
  apa7: "APA 7 — (Muallif, yil)",
  ieee: "IEEE — [1]",
};

/** Paketga sig'adigan sxema soni — `FIGURES_BY_PAGES` (server ham shu chegara bilan kesadi). */
const figureOptions = (pages: PagesId) => Array.from({ length: maxFiguresFor(pages) + 1 }, (_, n) => ({ value: String(n), label: String(n) }));
const clampFigures = (n: number, pages: PagesId) => Math.max(0, Math.min(maxFiguresFor(pages), n));

function emptyUi(profile: UserProfile, user: ServerUser | null): Ui {
  const type = ARTICLE_TYPES.imrad_oak;
  return {
    topic: "",
    articleType: type.id,
    pubProfile: type.defaultProfile,
    pubProfileTouched: false,
    citeStyle: "",
    language: "uz",
    pages: normalizeArticlePages(type, "3-5"),
    // Birinchi qator profildan prefill (`ResumeComposer` prefill naqshi) —
    // ism bo'lmasa foydalanuvchi nomi (`user.name`) zaxira.
    authors: [{ name: profile.author || user?.name || "", org: profile.organization || "" }],
    udk: "",
    keywords: [],
    userFacts: "",
    userRefs: [],
    userDataCsv: "",
    figureCount: clampFigures(2, normalizeArticlePages(type, "3-5")),
    figureKinds: [],
    research: true,
    extra: "",
    fileName: "",
    sourceText: "",
  };
}

/**
 * «Sarlavha qatori + qatorlar» CSV → `{categories, series}`.
 *
 * Server (`article/input.ts` `parseUserData`) buni QAYTA tekshiradi —
 * bu yerdagi tahlil faqat foydalanuvchiga DARHOL ogohlantirish uchun
 * («Jadval o'qilmadi»), yakuniy qaror serverda.
 */
function parseCsvUserData(raw: string): ArticleUserData | null {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const categories = lines[0]
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, ARTICLE_INPUT_LIMITS.categories);
  if (categories.length < 2) return null;
  const series = lines
    .slice(1)
    .map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      const name = (cells[0] || "").slice(0, ARTICLE_INPUT_LIMITS.seriesNameChars);
      const values = cells.slice(1).map((v) => Number(v));
      return { name, values };
    })
    .filter((s) => s.name && s.values.length === categories.length && s.values.every((v) => Number.isFinite(v)))
    .slice(0, ARTICLE_INPUT_LIMITS.series);
  if (!series.length) return null;
  return { categories, series };
}

/** Teskari yo'l — qoralama/qayta tiklashda obyektdan CSV matn. */
function csvFromUserData(u: ArticleUserData | undefined): string {
  if (!u || !u.categories.length) return "";
  return [u.categories.join(","), ...u.series.map((s) => [s.name, ...s.values].join(","))].join("\n");
}

function userRefRowOf(r: ArticleUserRef): UserRefRow {
  return { mode: r.doi ? "doi" : "text", doi: r.doi ?? "", raw: r.raw ?? "" };
}

/** Qoralamadagi `FormValues` → forma holati — bitta manba (`articleInputFromValues`). */
function uiFromValues(values: FormValues, base: Ui): Ui {
  const input = articleInputFromValues(values);
  const type = ARTICLE_TYPES[input.articleType];
  return {
    ...base,
    topic: input.topic,
    articleType: input.articleType,
    pubProfile: input.pubProfile,
    pubProfileTouched: input.pubProfile !== type.defaultProfile,
    citeStyle: input.citeStyle ?? "",
    language: input.language,
    pages: input.pages,
    authors: input.authors.length ? input.authors : base.authors,
    udk: input.udk,
    keywords: input.keywords,
    userFacts: input.userFacts,
    userRefs: input.userRefs.map(userRefRowOf),
    userDataCsv: csvFromUserData(input.userData) || base.userDataCsv,
    figureCount: input.figureCount,
    figureKinds: input.figureKinds,
    research: input.research,
    extra: input.extra,
    fileName: typeof values.fileName === "string" ? values.fileName : "",
    sourceText: input.sourceText,
  };
}

/** Forma holati → yuboriladigan `FormValues` — `encodeArticleValues` bitta manba. */
function toValues(ui: Ui): FormValues {
  const authors = ui.authors.filter((a) => a.name.trim());
  const userRefs: ArticleUserRef[] = ui.userRefs
    .map((r, i): ArticleUserRef | null => {
      if (r.mode === "doi") {
        const doi = r.doi.trim();
        return doi ? { id: `u${i + 1}`, doi } : null;
      }
      const raw = r.raw.trim();
      return raw ? { id: `u${i + 1}`, raw } : null;
    })
    .filter((r): r is ArticleUserRef => Boolean(r));
  const userData = parseCsvUserData(ui.userDataCsv) ?? undefined;

  const input: ArticleInput = {
    topic: ui.topic,
    articleType: ui.articleType,
    pubProfile: ui.pubProfile,
    language: ui.language,
    pages: ui.pages,
    authors,
    udk: ui.udk,
    keywords: ui.keywords,
    userFacts: ui.userFacts,
    userRefs,
    figureCount: ui.figureCount,
    figureKinds: ui.figureKinds,
    research: ui.research,
    extra: ui.extra,
    sourceText: ui.sourceText,
  };
  if (ui.citeStyle) input.citeStyle = ui.citeStyle;
  if (userData) input.userData = userData;

  const out = encodeArticleValues(input);
  if (ui.fileName) out.fileName = ui.fileName;
  return out;
}

export function ArticleComposer({
  tool,
  profile,
  user,
}: {
  tool: ToolConfig;
  profile: UserProfile;
  user: ServerUser | null;
}) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(() => emptyUi(profile, user));
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** UDK «Taklif» (AUDIT-18 Q-4): serverdan taklif — maydonga tushadi, ostida «tekshiring» izohi. */
  const [udkBusy, setUdkBusy] = useState(false);
  const [udkNote, setUdkNote] = useState<string | null>(null);
  const { draft, ready, save, clear, flush } = useFormDraft("article", { enabled: loggedIn });

  // Qoralama kelgach BIR marta qo'llanadi — foydalanuvchi yozayotgan
  // matnni keyinchalik ustiga yozib yuborish mumkin emas.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s));
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui));
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));
  const onSuggestUdk = async () => {
    if (udkBusy || ui.topic.trim().length < 3) return;
    setUdkBusy(true);
    setUdkNote(null);
    try {
      const r = await suggestUdk(ui.topic, ui.language);
      set("udk", r.udk.slice(0, ARTICLE_LIMITS.udkChars));
      setUdkNote(`${r.note}${r.label ? `: ${r.label}` : ""}`);
      setSettingsOpen(true);
    } catch (e) {
      setUdkNote(e instanceof Error ? e.message : "UDK taklif qilinmadi");
    } finally {
      setUdkBusy(false);
    }
  };
  const type = ARTICLE_TYPES[ui.articleType];
  const pubProfile = PUBLICATION_PROFILES[ui.pubProfile];
  /*
   * Paket — hujjatning UMUMIY beti, lekin apparatura (annotatsiya ×3, ikki
   * adabiyotlar ro'yxati, sxema) OAK'da 3–5 betlik paketdan katta: hujjat
   * ~6 bet chiqadi. Formula dvigatelniki (`article/plan.ts`) — foydalanuvchi
   * yaratishdan OLDIN ko'radi (mahsulot egasi qarori: yorliq halol, sifat
   * tushmaydi).
   */
  const pagesEstimate = estimateArticlePages(ui.pages, type, pubProfile, ui.figureCount);
  const pagesOver = pagesEstimate > pagesUpper(ui.pages);
  const pagesHint = pagesOver ? undefined : "Hujjatning umumiy beti — annotatsiya va adabiyotlar bilan";

  /*
   * Tur o'zgarganda: profil TURNING standartiga o'tadi — lekin FAQAT
   * foydalanuvchi profilni hali qo'lda tanlamagan bo'lsa (mutatsiya
   * testi: bu bog'lanish olib tashlansa `article-composer` testi
   * qizarishi kerak). Hajm esa yangi turning ro'yxatida bo'lmasa
   * BIRINCHI mos paketga tushadi — narx ham shu bitta qoidadan
   * (`priceFor` → `normalizeArticlePages`), ya'ni ekranda ko'ringan
   * hajm va to'lanadigan narx hech qachon ayril bo'lmaydi.
   */
  function onTypeChange(id: ArticleTypeId) {
    const nextType = ARTICLE_TYPES[id];
    setUi((s) => ({
      ...s,
      articleType: id,
      pubProfile: s.pubProfileTouched ? s.pubProfile : nextType.defaultProfile,
      pages: normalizeArticlePages(nextType, s.pages),
      figureCount: clampFigures(s.figureCount, normalizeArticlePages(nextType, s.pages)),
    }));
  }
  function onPagesChange(pages: PagesId) {
    setUi((s) => ({ ...s, pages, figureCount: clampFigures(s.figureCount, pages) }));
  }
  function onProfileChange(id: PublicationProfileId) {
    setUi((s) => ({ ...s, pubProfile: id, pubProfileTouched: true }));
  }

  const keywordSuggest = useMemo(() => {
    return (q: string) => {
      const words = Array.from(new Set(ui.topic.split(/[\s,.;:!?()«»"']+/).filter((w) => w.length > 3)));
      const query = q.trim().toLowerCase();
      return words
        .filter((w) => !query || w.toLowerCase().includes(query))
        .slice(0, 6)
        .map((w) => ({ id: w, label: w }));
    };
  }, [ui.topic]);

  const values = toValues(ui);
  const price = priceFor(tool, values);
  const userDataInvalid = ui.userDataCsv.trim().length > 0 && !parseCsvUserData(ui.userDataCsv);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(profile, user));
  });

  async function submit() {
    setError(null);
    if (!ui.topic.trim()) {
      setError("Mavzuni kiriting");
      return;
    }
    setLoading(true);
    flush();
    try {
      const v = toValues(ui);
      const id = await runGeneration(tool, v);
      const first = ui.authors[0];
      if (first?.name.trim()) {
        const patch = profilePatchFrom({ author: first.name, organization: first.org ?? "" }, profile);
        if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
      }
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Mavzu va tur">
        <Row label="Mavzu" wide>
          <span data-field="topic" className="block">
            <TextInput value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} />
          </span>
        </Row>
        {tool.topicExamples?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tool.topicExamples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => set("topic", ex)}
                className="bg-muted hover:bg-muted/70 rounded-md px-2 py-1 text-left text-[11px]"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        <Row label="Tur" wide>
          <span data-field="articleType" className="block">
            <ArticleTypeTile value={ui.articleType} language={ui.language} onChange={onTypeChange} />
          </span>
        </Row>
      </Card>

      <Card title="Nashr profili">
        <Row label="Profil" wide>
          <span data-field="pubProfile" className="block">
            <PublicationProfileTile value={ui.pubProfile} onChange={onProfileChange} />
          </span>
        </Row>
      </Card>

      <Card title="Mualliflar" aside={<span className="text-muted-foreground text-[11px]">{ui.authors.length}/{ARTICLE_LIMITS.authors}</span>}>
        <span data-field="authors" id="authors" className="block">
          <RowList
            name="authors"
            rows={ui.authors}
            onChange={(rows) => set("authors", rows)}
            max={ARTICLE_LIMITS.authors}
            addLabel="Muallif"
            empty="Kamida bitta muallifni qo‘shing."
            add={() => ({ name: "" }) as ArticleAuthor}
            render={(row, set2) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <TextInput value={row.name} onChange={(v) => set2({ name: v })} placeholder="F.I.Sh." />
                <TextInput value={row.degree ?? ""} onChange={(v) => set2({ degree: v })} placeholder="Unvon / ilmiy daraja" />
                <TextInput value={row.org ?? ""} onChange={(v) => set2({ org: v })} placeholder="Tashkilot" />
                <TextInput value={row.email ?? ""} onChange={(v) => set2({ email: v })} placeholder="Email" />
                <TextInput value={row.orcid ?? ""} onChange={(v) => set2({ orcid: v })} placeholder="ORCID: 0000-0000-0000-0000" />
              </div>
            )}
          />
        </span>
      </Card>

      <Card title="Materiallar">
        <div data-source-file>
          <SourceFileField
            legend="Hujjat yuklang (ixtiyoriy)"
            fileName={ui.fileName}
            sourceText={ui.sourceText}
            onChange={({ fileName, sourceText }) => setUi((s) => ({ ...s, fileName, sourceText }))}
            onBusyChange={setFileBusy}
          />
        </div>
        <Row label="Natijalarim" hint="AI faqat shu faktlarga tayanadi — raqamlar, namuna hajmi, davr" wide>
          <span data-field="userFacts" id="userFacts" className="block">
            <TextArea
              value={ui.userFacts}
              onChange={(v) => set("userFacts", v.slice(0, ARTICLE_LIMITS.userFactsChars))}
              placeholder="Tajribada 120 talaba ishtirok etdi, o‘rtacha ball 4,1 dan 4,6 ga oshdi."
            />
          </span>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {ui.userFacts.length.toLocaleString("uz-UZ")}/{ARTICLE_LIMITS.userFactsChars.toLocaleString("uz-UZ")}
          </p>
        </Row>
        <Row label="Mening manbalarim" wide>
          <span data-field="userRefs" className="block">
            <RowList
              name="userRefs"
              rows={ui.userRefs}
              onChange={(rows) => set("userRefs", rows)}
              max={ARTICLE_LIMITS.userRefs}
              addLabel="Manba"
              empty="DOI yoki erkin matnli manba qo‘shing."
              add={() => ({ mode: "doi" as const, doi: "", raw: "" })}
              render={(row, set2) => (
                <div className="flex flex-col gap-1.5">
                  <Segmented
                    ariaLabel="Manba turi"
                    options={[
                      { value: "doi", label: "DOI" },
                      { value: "text", label: "Matn" },
                    ]}
                    value={row.mode}
                    onChange={(v) => set2({ mode: v as UserRefRow["mode"] })}
                  />
                  {row.mode === "doi" ? (
                    <TextInput value={row.doi} onChange={(v) => set2({ doi: v })} placeholder="10.1186/s40561-023-00260-y" />
                  ) : (
                    <TextArea
                      value={row.raw}
                      onChange={(v) => set2({ raw: v.slice(0, ARTICLE_INPUT_LIMITS.rawRefChars) })}
                      placeholder="Karimov A. Ta’limda AI. — Toshkent: Fan, 2022."
                    />
                  )}
                </div>
              )}
            />
          </span>
        </Row>
        <Row label="Ma’lumot jadvali" hint="Grafik faqat shu ma’lumotdan chiziladi — raqam o‘ylab topilmaydi" wide>
          <span data-field="userData" className="block">
            <TextArea
              value={ui.userDataCsv}
              onChange={(v) => set("userDataCsv", v)}
              placeholder={"CSV: sarlavha qatori + qatorlar\n2022,2023,2024\nTalabalar,80,110,120"}
            />
          </span>
          {userDataInvalid ? (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
              Jadval o‘qilmadi — birinchi qator sarlavhalar (kamida 2 ustun), keyingi har qator: nom,son,son…
              (son soni sarlavha soniga teng bo‘lishi kerak).
            </p>
          ) : null}
        </Row>
      </Card>

      <Card title="Hajm va til">
        <Row label="Hajm" hint={pagesHint}>
          <span data-field="pages" className="block">
            <Segmented
              ariaLabel="Hajm"
              options={type.pages.map((id) => ({ value: id, label: `${PAGE_LABEL[id]} · ${formatTanga(ARTICLE_PRICES[id])}` }))}
              value={ui.pages}
              onChange={(v) => onPagesChange(v as PagesId)}
            />
            {pagesOver ? (
              <p data-pages-estimate={pagesEstimate} className="text-muted-foreground mt-1 text-[11px]">
                {pubProfile.label.uz} profilida uch tilli annotatsiya, adabiyotlar ro‘yxati{pubProfile.secondEnglishList ? " (ikki ro‘yxat)" : ""} va sxema qo‘shimcha joy oladi — hujjat taxminan{" "}
                <b>{pagesEstimate} bet</b> chiqadi; matn hajmi paketga mos.
              </p>
            ) : null}
          </span>
        </Row>
        <Row label="Til">
          <span data-field="language" className="block">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v as Ui["language"])} />
          </span>
        </Row>
        <p className="text-muted-foreground mt-1.5 text-[11px]">Annotatsiya: uz + ru + en (har doim uch tilda chiqadi)</p>
      </Card>

      <details
        open={settingsOpen}
        onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="bg-card mb-3 rounded-2xl border p-4"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">Sozlamalar</span>
          {!settingsOpen ? (
            <SummaryChips
              items={[
                ui.udk ? `UDK ${ui.udk}` : "",
                ui.keywords.length ? `${ui.keywords.length} kalit so‘z` : "",
                `${ui.figureCount} vizual`,
                ui.figureCount && ui.figureKinds.length ? `sxema: ${ui.figureKinds.map((k) => FIGURE_KIND_LABEL[k].toLowerCase()).join(", ")}` : "",
                ui.research ? "internet qidiruvi yoqilgan" : "internet qidiruvi o‘chirilgan",
                ui.citeStyle ? CITE_STYLE_LABEL[ui.citeStyle] : "",
              ].filter(Boolean)}
            />
          ) : null}
        </summary>
        <div className="mt-3">
          <Row label="UDK" hint="Jurnal talab qilsa; «Taklif» — AI mavzudan UDK sinfini taklif qiladi, tekshirib tasdiqlang">
            <span data-field="udk" id="udk" className="flex items-start gap-2">
              <span className="min-w-0 flex-1">
                <TextInput value={ui.udk} onChange={(v) => set("udk", v.slice(0, ARTICLE_LIMITS.udkChars))} placeholder="004.8" />
              </span>
              <button
                type="button"
                className="bg-card shrink-0 rounded-md border px-2.5 py-1.5 text-xs disabled:opacity-50"
                disabled={udkBusy || ui.topic.trim().length < 3}
                title={ui.topic.trim().length < 3 ? "Avval mavzuni kiriting" : "AI mavzudan UDK taklif qiladi"}
                onClick={() => void onSuggestUdk()}
                data-udk-suggest
                aria-busy={udkBusy || undefined}
              >
                {udkBusy ? "Taklif…" : "Taklif"}
              </button>
            </span>
            {udkNote ? (
              <p className="text-muted-foreground mt-1 text-[11px]" data-udk-note>
                {udkNote}
              </p>
            ) : null}
          </Row>
          <Row label="Kalit so‘zlar" hint="5–12 ta, mavzudan tavsiya qilinadi" wide>
            <span data-field="keywords" className="block">
              <Combobox
                multi
                ariaLabel="Kalit so‘zlar"
                value={ui.keywords}
                onChange={(v) => set("keywords", v)}
                suggest={keywordSuggest}
                max={ARTICLE_LIMITS.keywords}
                placeholder="sun’iy intellekt, ta’lim…"
              />
            </span>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {ui.keywords.length}/{ARTICLE_LIMITS.keywords}
            </p>
          </Row>
          <Row label="Vizuallar soni" hint={maxFiguresFor(ui.pages) ? `Sxema/grafik soni — ${PAGE_LABEL[ui.pages]} betga ${maxFiguresFor(ui.pages)} tagacha sig‘adi` : "Tezisda sxema chizilmaydi"}>
            <span data-field="figureCount" className="block">
              {maxFiguresFor(ui.pages) ? (
                <Segmented
                  ariaLabel="Vizuallar soni"
                  options={figureOptions(ui.pages)}
                  value={String(ui.figureCount)}
                  onChange={(v) => set("figureCount", Number(v))}
                />
              ) : (
                <span className="text-muted-foreground text-sm">0</span>
              )}
            </span>
          </Row>
          <Row label="Sxema turlari" hint={ui.figureCount ? "Avto — mazmunga qarab; tanlasangiz faqat shu turlar chiziladi" : "Sxema so‘ralmagan"} wide>
            <span data-field="figureKinds" className="block">
              <FigureKindChips value={ui.figureKinds} onChange={(v) => set("figureKinds", v)} disabled={ui.figureCount === 0} />
            </span>
          </Row>
          <Row label="Manba qidiruvi" hint="OpenAlex/Crossref orqali tekshirilgan manba topadi">
            <span data-field="research" className="block">
              <Switch checked={ui.research} onChange={(v) => set("research", v)} ariaLabel="Internetdan manba qidirish" />
            </span>
          </Row>
          <Row label="Iqtibos uslubi" hint="Profil standartini bekor qiladi">
            <span data-field="citeStyle" className="block">
              <SelectField
                ariaLabel="Iqtibos uslubi"
                options={[{ value: "", label: "Profil standarti" }, ...CITE_STYLES.map((c) => ({ value: c, label: CITE_STYLE_LABEL[c] }))]}
                value={ui.citeStyle}
                onChange={(v) => set("citeStyle", v as Ui["citeStyle"])}
              />
            </span>
          </Row>
          <Row label="Qo‘shimcha" hint="Modelga alohida talab (masalan, uslub bo‘yicha)" wide>
            <span data-field="extra" className="block">
              <TextArea value={ui.extra} onChange={(v) => set("extra", v.slice(0, ARTICLE_INPUT_LIMITS.extraChars))} placeholder="Ixtiyoriy" />
            </span>
          </Row>
          <div className="mt-2">
            <button type="button" onClick={clearConfirm.trigger} className="text-muted-foreground hover:text-destructive text-[12px]">
              {clearConfirm.armed ? "Ishonchingiz komilmi? Yana bosing" : "Formani tozalash"}
            </button>
          </div>
        </div>
      </details>
      {fileBusy ? <p className="text-muted-foreground -mt-2 mb-4 text-[11px]">Fayl o‘qilmoqda…</p> : null}
    </ToolChrome>
  );
}
