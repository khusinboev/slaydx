"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { formatTanga, priceFor } from "@/lib/tools";
import { ESSAY_DESIGNS } from "@/lib/languages";
/*
 * Import ATAYIN modullardan, `essay/index.ts` barrelidan EMAS: barrel
 * `engine.ts`/`polish.ts` ni ham olib keladi (LLM rollari, qo'riqchi,
 * baholovchi) va ular mijoz bundle'iga tushardi. Bu yerda kerak bo'lgani
 * — SOF ma'lumot (reyestr, chegaralar) va izomorf kirish o'girmasi
 * (`input.ts`); `ArticleComposer` ham shu qoida bilan yozilgan.
 */
import { ESSAY_CONTEXT_IDS, ESSAY_LIMITS, essayKindsOf, type EssayContextId, type EssayKindId } from "@/lib/generation/essay/types";
import { ESSAY_CONTEXTS, essayKindSpec, essayWords, type EssayLang, type EssayPerson } from "@/lib/generation/essay/registry";
import { encodeEssayValues, essayInputFromValues, type EssayInput } from "@/lib/generation/essay/input";
import { Card, Row, Segmented, SummaryChips } from "./compact";
import { TextArea, TextInput } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * Insho formasi (Talaba ishlari 2 / AUDIT-19, WP-E1) — `ArticleComposer`
 * naqshi: ixcham kartalar, bitta sahifa, qoralama serverda
 * (`useFormDraft("essay")`).
 *
 * Formaning butun mantiqi bitta so'zga tayanadi — KONTEKST. Maktab/DTM
 * inshosi, OTM akademik essesi va IELTS Task 2 uch xil janr: turlar
 * ro'yxati, hajm o'lchovi (varaq yoki so'z), ruxsat etilgan til, epigraf
 * siyosati va hatto bayon shaxsi ham shundan chiqadi
 * (`essay/registry.ts`). Shuning uchun kontekst o'zgarganda qolgan
 * maydonlar NORMALLASHADI — va bu normallashtirish shu yerda QAYTA
 * yozilmaydi: `toValues` → `essayInputFromValues` → `uiFromValues`
 * aylanasi serverdagi AYNAN o'sha funksiyadan o'tadi. Ya'ni ekranda
 * ko'ringan tanlov bilan dvigatel oladigan tanlov hech qachon ayril
 * bo'lmaydi (IELTS uchun «o'zbekcha» yoki akademik esse uchun «adabiy
 * tahlil» tanlab bo'lmaydi).
 *
 * Reyestr shartnomasi: `lib/generation/essay-params.ts` dagi HAR
 * `ESSAY_PARAMS.id` shu yerda `data-field={id}` bilan chizilgan bo'lishi
 * SHART (`tests/ui/essay-composer.test.mts` qamrov testi) — «bezak
 * maydon yo'q».
 *
 * NARX O'ZGARMAYDI (mahsulot egasi qarori): `priceFor` baribir `pages`
 * chipidan. So'z bilan o'lchanadigan kontekstlarda varaq foydalanuvchiga
 * ko'rinmaydi, lekin `toValues` uni so'zdan hisoblaydi (1 varaq ≈ 250
 * so'z) — ekranda ko'ringan narx server hisoblaydigan narx bilan bir xil.
 */

type Ui = {
  topic: string;
  context: EssayContextId;
  kind: EssayKindId;
  language: EssayLang;
  /** Varaq (1–5) — maktab/DTM kontekstida hajm ham, narx ham shundan. */
  pages: number;
  /** So'z maqsadi — akademik esseda (IELTS chegarasi qat'iy). */
  wordTarget: number;
  workTitle: string;
  epigraphText: string;
  epigraphAuthor: string;
  userFacts: string;
  design: string;
  person: EssayPerson;
  extra: string;
};

/* ────────────────────────── yorliqlar ────────────────────────── */

const CONTEXT_OPTIONS = ESSAY_CONTEXT_IDS.map((id) => ({ value: id, label: ESSAY_CONTEXTS[id].label.uz }));

const LANGUAGE_LABEL: Record<EssayLang, string> = { uz: "O‘zbek", ru: "Русский", en: "English" };

const PERSON_OPTIONS = [
  { value: "first", label: "1-shaxs («men»)" },
  { value: "third", label: "3-shaxs (xolis)" },
];

/** Akademik esse hajmi — `ESSAY_CONTEXTS.academic.wordRange` (500–1 000) ichida. */
const WORD_OPTIONS = [500, 750, 1000];

/**
 * So'z → varaq (narx uchun). «1 varaq ≈ 250 so'z» —
 * `ESSAY_LIMITS.academicWordsPerPage`, ya'ni `essayInputFromValues`
 * bilan BITTA manba: u ham `wordTarget` berilmaganda `pages × 250`
 * bo'yicha hisoblaydi.
 */
function pagesForWords(words: number): number {
  const n = Math.ceil(Math.max(1, words) / ESSAY_LIMITS.academicWordsPerPage);
  return Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, n));
}

/** Foydalanuvchiga ko'rinadigan hajm izohi — dvigatelning O'Z byudjetidan. */
function wordsHint(ui: Ui): string {
  const w = essayWords(ui.context, { pages: ui.pages, wordTarget: ui.wordTarget });
  return `${w.min}–${w.max} so‘z (mo‘ljal ${w.aim})`;
}

function emptyUi(): Ui {
  return {
    topic: "",
    context: "school_dtm",
    kind: essayKindsOf("school_dtm")[0],
    language: "uz",
    pages: 2,
    wordTarget: ESSAY_CONTEXTS.academic.wordRange!.aim,
    workTitle: "",
    epigraphText: "",
    epigraphAuthor: "",
    userFacts: "",
    design: "iris",
    person: ESSAY_CONTEXTS.school_dtm.person,
    extra: "",
  };
}

/* ────────────────────────── holat ↔ qiymatlar ────────────────────────── */

/**
 * Forma holati → yuboriladigan `FormValues`. `encodeEssayValues` bitta
 * manba; `pages` esa shu yerda hisoblanadi, chunki so'z bilan
 * o'lchanadigan kontekstlarda foydalanuvchi varaqni tanlamaydi, narx esa
 * baribir varaqdan (mahsulot egasi qarori: narxlar o'zgarmaydi).
 */
function toValues(ui: Ui): FormValues {
  const spec = ESSAY_CONTEXTS[ui.context];
  const pages =
    spec.sizing === "pages"
      ? ui.pages
      : ui.context === "ielts_task2"
        ? // IELTS 250–330 so'z — bir varaq; paket ham, narx ham eng kichigi.
          ESSAY_LIMITS.pagesMin
        : pagesForWords(ui.wordTarget);
  const input: Partial<EssayInput> = {
    topic: ui.topic,
    context: ui.context,
    kind: ui.kind,
    language: ui.language,
    pages,
    wordTarget: spec.sizing === "words" && ui.context !== "ielts_task2" ? ui.wordTarget : 0,
    workTitle: ui.workTitle,
    epigraph: ui.epigraphText.trim() ? { text: ui.epigraphText, author: ui.epigraphAuthor } : null,
    userFacts: ui.userFacts,
    design: ui.design,
    person: ui.person,
    extra: ui.extra,
  };
  return encodeEssayValues(input);
}

/**
 * Qoralama/normallashtirish yo'li: `FormValues` → forma holati.
 * SERVER funksiyasidan o'tadi (`essayInputFromValues`) — nomuvofiq tur,
 * til va hajm shu yerda emas, dvigatel bilan BITTA qoida bo'yicha
 * to'g'rilanadi.
 */
function uiFromValues(values: FormValues, base: Ui): Ui {
  const input = essayInputFromValues(values);
  const spec = ESSAY_CONTEXTS[input.context];
  return {
    ...base,
    topic: input.topic,
    context: input.context,
    kind: input.kind,
    language: input.language,
    pages: input.pages,
    // Hajm so'z bilan o'lchanmaydigan kontekstda oxirgi tanlov saqlanadi
    // (foydalanuvchi akademikka qaytsa, 750 so'z tanlovi yo'qolmasin).
    wordTarget: spec.sizing === "words" && input.wordTarget ? input.wordTarget : base.wordTarget,
    workTitle: input.workTitle,
    epigraphText: input.epigraph?.text ?? "",
    epigraphAuthor: input.epigraph?.author ?? "",
    userFacts: input.userFacts,
    design: input.design,
    person: input.person,
    extra: input.extra,
  };
}

/* ────────────────────────── dizayn chiplari ────────────────────────── */

/** `ESSAY_DESIGNS` — hujjat ramkasi; rangli chip (`fields.tsx DesignPicker` ixcham varianti). */
function DesignChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hujjat ramkasi">
      {ESSAY_DESIGNS.map((d) => {
        const on = value === d.value;
        return (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-design={d.value}
            onClick={() => onChange(d.value)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-primary ring-primary/40 ring-2" : "border-input hover:bg-muted"}`}
          >
            <span className="size-3 rounded-full" style={{ background: `linear-gradient(135deg, ${d.from}, ${d.to})` }} aria-hidden="true" />
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────── forma ────────────────────────── */

export function EssayComposer({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(emptyUi);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

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

  /*
   * Kontekst va tur — YAGONA normallashtirish nuqtasi: yangi qiymat
   * `toValues` → `essayInputFromValues` → `uiFromValues` aylanasidan
   * o'tadi. Shuning uchun «IELTS + o'zbek tili» yoki «akademik esse +
   * adabiy tahlil (maktab turi)» kabi holat umuman yuzaga kelmaydi va
   * qoida forma bilan dvigatelda IKKI joyda yozilmaydi.
   */
  const onContext = (id: EssayContextId) => setUi((s) => uiFromValues({ ...toValues(s), essayContext: id }, s));
  const onKind = (id: EssayKindId) => setUi((s) => uiFromValues({ ...toValues(s), essayKind: id }, s));

  const spec = ESSAY_CONTEXTS[ui.context];
  const kindSpec = essayKindSpec(ui.context, ui.kind);
  const values = toValues(ui);
  const price = priceFor(tool, values);
  const pageLabel = (n: number) => `${n} varaq`;

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi());
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
      const id = await runGeneration(tool, toValues(ui));
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Mavzu va kontekst">
        <Row label="Mavzu" wide>
          <span data-field="topic" className="block">
            <TextInput value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} />
          </span>
        </Row>
        <Row label="Kontekst" hint={spec.hint} wide>
          <span data-field="essayContext" className="block">
            <Segmented ariaLabel="Insho konteksti" options={CONTEXT_OPTIONS} value={ui.context} onChange={(v) => onContext(v as EssayContextId)} />
          </span>
          <p className="text-muted-foreground mt-1 text-[11px]">{spec.hint}</p>
        </Row>
        <Row label="Tur" hint={kindSpec.hint} wide>
          <span data-field="essayKind" className="block">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Insho turi">
              {essayKindsOf(ui.context).map((id) => {
                const k = essayKindSpec(ui.context, id);
                const on = ui.kind === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-kind={id}
                    title={k.hint}
                    onClick={() => onKind(id)}
                    className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`}
                  >
                    {k.label.uz}
                  </button>
                );
              })}
            </div>
          </span>
          <p className="text-muted-foreground mt-1 text-[11px]">{kindSpec.hint}</p>
        </Row>
      </Card>

      <Card title="Hajm va til">
        {spec.sizing === "pages" ? (
          <Row label="Hajm" hint={wordsHint(ui)}>
            <span data-field="pages" className="block">
              <Segmented
                ariaLabel="Insho hajmi"
                options={Array.from({ length: ESSAY_LIMITS.pagesMax - ESSAY_LIMITS.pagesMin + 1 }, (_, i) => {
                  const n = ESSAY_LIMITS.pagesMin + i;
                  return { value: String(n), label: `${pageLabel(n)} · ${formatTanga(priceFor(tool, { pages: String(n) } as FormValues))}` };
                })}
                value={String(ui.pages)}
                onChange={(v) => set("pages", Number(v))}
              />
            </span>
          </Row>
        ) : ui.context === "ielts_task2" ? (
          /*
           * IELTS — hajm QAT'IY (rasmiy minimum 250 so'z, 330 dan
           * ortig'i vaqtga sig'maydi va band bermaydi), shuning uchun
           * tanlov yo'q. `pages` maydoni baribir reyestrda: narx undan
           * hisoblanadi (1 varaq) va zond uni o'lchaydi.
           */
          <Row label="Hajm" hint="IELTS Writing Task 2 rasmiy minimumi — 250 so‘z">
            <span data-field="pages" data-fixed="ielts" className="text-sm">
              250+ so‘z · {formatTanga(price)}
            </span>
          </Row>
        ) : (
          <Row label="Hajm" hint={wordsHint(ui)}>
            <span data-field="wordTarget" className="block">
              <Segmented
                ariaLabel="So‘z hajmi"
                options={WORD_OPTIONS.map((w) => ({
                  value: String(w),
                  label: `${w} so‘z · ${formatTanga(priceFor(tool, { pages: String(pagesForWords(w)) } as FormValues))}`,
                }))}
                value={String(ui.wordTarget)}
                onChange={(v) => set("wordTarget", Number(v))}
              />
            </span>
            {/*
             * Varaq akademik esseda ko'rsatilmaydi (hajm so'z bilan
             * o'lchanadi), lekin reyestr maydoni sifatida mavjud va narx
             * aynan shundan — qamrov testi uni shu yerdan topadi.
             */}
            <span data-field="pages" hidden data-pages={pagesForWords(ui.wordTarget)} />
          </Row>
        )}
        <Row label="Til" hint={spec.languages.length === 1 ? `Bu kontekstda faqat ${LANGUAGE_LABEL[spec.languages[0]]}` : undefined}>
          <span data-field="language" className="block">
            <Segmented
              ariaLabel="Insho tili"
              options={spec.languages.map((l) => ({ value: l, label: LANGUAGE_LABEL[l] }))}
              value={ui.language}
              onChange={(v) => set("language", v as EssayLang)}
            />
          </span>
        </Row>
      </Card>

      <Card title="Materiallar">
        <Row label="O‘z fikrlarim" hint="AI o‘ylab topmaydigan narsa — shaxsiy tajriba, kuzatuv, raqam" wide>
          <span data-field="userFacts" id="userFacts" className="block">
            <TextArea
              value={ui.userFacts}
              onChange={(v) => set("userFacts", v.slice(0, ESSAY_LIMITS.userFactsChars))}
              placeholder="Sinfimizda o‘tkazgan so‘rovimda 28 o‘quvchidan 22 tasi kuniga bir soatdan kam kitob o‘qishini aytdi."
            />
          </span>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {ui.userFacts.length.toLocaleString("uz-UZ")}/{ESSAY_LIMITS.userFactsChars.toLocaleString("uz-UZ")}
          </p>
        </Row>
        {kindSpec.needsWork ? (
          <Row label="Asar nomi" hint="Iqtibos FAQAT shu asardan olinadi — uydirma parcha yozilmaydi" wide>
            <span data-field="workTitle" id="workTitle" className="block">
              <TextInput value={ui.workTitle} onChange={(v) => set("workTitle", v.slice(0, ESSAY_LIMITS.workTitleChars))} placeholder="O‘tkan kunlar" />
            </span>
          </Row>
        ) : null}
        {(kindSpec.epigraph ?? spec.epigraph) === "optional" ? (
          <Row label="Epigraf" hint="Ixtiyoriy. Iqtibosni O‘ZINGIZ tanlaysiz — AI epigraf o‘ylab topmaydi" wide>
            <span data-field="epigraph" id="epigraph" className="block space-y-1.5">
              <TextInput value={ui.epigraphText} onChange={(v) => set("epigraphText", v.slice(0, ESSAY_LIMITS.epigraphChars))} placeholder="So‘z — qalb kaliti" />
              <TextInput
                value={ui.epigraphAuthor}
                onChange={(v) => set("epigraphAuthor", v.slice(0, ESSAY_LIMITS.epigraphAuthorChars))}
                placeholder="Muallif (masalan, Alisher Navoiy)"
              />
            </span>
          </Row>
        ) : null}
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
                ESSAY_DESIGNS.find((d) => d.value === ui.design)?.label ?? ui.design,
                ui.person === "first" ? "1-shaxs" : "3-shaxs",
                ui.extra ? "qo‘shimcha talab bor" : "",
              ].filter(Boolean)}
            />
          ) : null}
        </summary>
        <div className="mt-3">
          <Row label="Ramka" hint="Hujjat sarvarag‘i va sarlavha ranglari" wide>
            <span data-field="design" className="block">
              <DesignChips value={ui.design} onChange={(v) => set("design", v)} />
            </span>
          </Row>
          <Row label="Bayon shaxsi" hint="Kontekst standarti: maktab inshosi va IELTS — 1-shaxs, akademik esse — xolis 3-shaxs">
            <span data-field="person" className="block">
              <Segmented ariaLabel="Bayon shaxsi" options={PERSON_OPTIONS} value={ui.person} onChange={(v) => set("person", v as EssayPerson)} />
            </span>
          </Row>
          <Row label="Qo‘shimcha" hint="Modelga alohida talab (masalan, uslub bo‘yicha)" wide>
            <span data-field="extra" className="block">
              <TextArea value={ui.extra} onChange={(v) => set("extra", v.slice(0, ESSAY_LIMITS.extraChars))} placeholder="Ixtiyoriy" />
            </span>
          </Row>
          <div className="mt-2">
            <button type="button" onClick={clearConfirm.trigger} className="text-muted-foreground hover:text-destructive text-[12px]">
              {clearConfirm.armed ? "Ishonchingiz komilmi? Yana bosing" : "Formani tozalash"}
            </button>
          </div>
        </div>
      </details>
    </ToolChrome>
  );
}
