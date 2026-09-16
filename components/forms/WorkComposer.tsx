"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { updateProfile, type ServerUser } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { profilePatchFrom } from "@/lib/profile-sync";
import { priceFor, formatTanga, defaultPages } from "@/lib/tools";
import type { SelectableFigureKind } from "@/lib/generation/article/types";
import type { ArticleUserRef } from "@/lib/generation/article/input";
import {
  WORK_GENRES,
  workKindOf,
  workKindsOf,
  normalizeWorkPages,
  type WorkKind,
} from "@/lib/generation/work/registry";
import { SUBJECT_PROFILES, SUBJECT_PROFILE_LIST } from "@/lib/generation/work/subjects";
import {
  workGenreOfTool,
  type WorkGenreId,
  type WorkKindId,
  type SubjectProfileId,
  type WorkMinistryId,
} from "@/lib/generation/work/types";
import { workInputFromValues, encodeWorkValues, parseWorkOutline, maxVisualsFor, type WorkInput } from "@/lib/generation/work/input";
import { Card, Row, Segmented, Switch, SummaryChips } from "./compact";
import { TextArea, TextInput } from "./fields";
import { Combobox } from "./Combobox";
import { RowList } from "./RowList";
import { SourceFileField } from "./SourceFileField";
import { FIGURE_KIND_LABEL, FigureKindChips } from "./ArticleComposer";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * Talaba ishlari 2 (AUDIT-19, WP-E2) — kurs ishi / referat / mustaqil ish
 * UMUMIY formasi: `ArticleComposer` naqshi (kartalar, `useFormDraft`,
 * `runGeneration`, `uiFromValues` ↔ `encodeWorkValues` bitta manba).
 *
 * Reyestr shartnomasi: `lib/generation/work-params.ts` dagi HAR
 * `WORK_PARAMS.id` shu yerda (bevosita yoki holat almashtirilgach)
 * `data-field={id}` bilan chizilishi SHART (`tests/ui/work-composer.test.mts`
 * qamrov testi) — «bezak maydon yo'q» qoidasi. `fileName` reyestrda YO'Q
 * (Article bilan bir xil sabab — fayl nomi hisobga ta'sir qilmaydi).
 *
 * `genre` uch vositaning `tool.id`sidan kelib chiqadi
 * (`workGenreOfTool`) — formada alohida maydon emas.
 */

type UserRefRow = { mode: "doi" | "isbn" | "text"; doi: string; isbn: string; raw: string };

type Ui = {
  topic: string;
  workKind: WorkKindId;
  subjectProfile: SubjectProfileId;
  subjectName: string;
  language: "uz" | "ru" | "en";
  pages: string;
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  teacher: string;
  teacherDegree: string;
  city: string;
  ministry: WorkMinistryId;
  ministryCustom: string;
  tocMethod: "ai" | "manual";
  tocText: string;
  includeVisuals: boolean;
  figureCount: number;
  figureKinds: SelectableFigureKind[];
  tableCount: number;
  userFacts: string;
  userRefs: UserRefRow[];
  refsMin: number;
  /** Foydalanuvchi qo'lda o'zgartirgan bo'lsa, tur almashganda ustidan yozilmaydi. */
  refsMinTouched: boolean;
  extra: string;
  /** Foydalanuvchi qo'lda o'zgartirgan bo'lsa, fan profili almashganda ustidan yozilmaydi. */
  visualsTouched: boolean;
  fileName: string;
  sourceText: string;
};

const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbek" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

const MINISTRY_OPTIONS = [
  { value: "oliy", label: "Oliy ta'lim" },
  { value: "maktab", label: "Maktab ta'limi" },
  { value: "custom", label: "Boshqa (o'zim yozaman)" },
];

/** «Fan nomi» tavsiyalari — erkin matn, ro'yxat faqat yordam. */
const SUBJECT_NAME_SUGGESTIONS = [
  "Pedagogika",
  "Psixologiya",
  "Iqtisodiyot nazariyasi",
  "Menejment",
  "Marketing",
  "Moliya",
  "Buxgalteriya hisobi",
  "Huquqshunoslik asoslari",
  "Konstitutsiyaviy huquq",
  "Fuqarolik huquqi",
  "Dasturlash asoslari",
  "Ma'lumotlar bazasi",
  "Kompyuter tarmoqlari",
  "Matematik tahlil",
  "Ehtimollar nazariyasi",
  "Fizika",
  "Kimyo",
  "Biologiya",
  "Ekologiya",
  "Tarix",
  "Falsafa",
  "Ona tili va adabiyot",
  "Ingliz tili",
  "Sotsiologiya",
];

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** «10-15» → «10–15 bet». */
const pagesLabel = (id: string) => `${id.replace("-", "–")} bet`;

function emptyUi(profile: UserProfile, tool: ToolConfig, genre: WorkGenreId): Ui {
  const g = WORK_GENRES[genre];
  const kind = g.kinds[g.defaultKind]!;
  const defaults = SUBJECT_PROFILES.humanities.defaultVisuals;
  return {
    topic: "",
    workKind: kind.id,
    subjectProfile: "humanities",
    subjectName: profile.subject || "",
    language: "uz",
    pages: normalizeWorkPages(kind, defaultPages(tool.id)),
    university: profile.university || "",
    faculty: profile.faculty || "",
    department: profile.department || "",
    group: profile.group || "",
    course: profile.course || "",
    author: profile.author || "",
    teacher: profile.teacher || "",
    teacherDegree: "",
    city: profile.city || "",
    ministry: "oliy",
    ministryCustom: "",
    tocMethod: "ai",
    tocText: "",
    includeVisuals: true,
    figureCount: defaults.figures,
    figureKinds: [],
    tableCount: defaults.tables,
    userFacts: "",
    userRefs: [],
    refsMin: kind.refsMin,
    refsMinTouched: false,
    extra: "",
    visualsTouched: false,
    fileName: "",
    sourceText: "",
  };
}

function userRefRowOf(r: ArticleUserRef): UserRefRow {
  return { mode: r.doi ? "doi" : r.isbn ? "isbn" : "text", doi: r.doi ?? "", isbn: r.isbn ?? "", raw: r.raw ?? "" };
}

/** Qoralamadagi `FormValues` → forma holati — bitta manba (`workInputFromValues`). */
function uiFromValues(values: FormValues, base: Ui, genre: WorkGenreId): Ui {
  const input = workInputFromValues(values, genre);
  return {
    ...base,
    topic: input.topic,
    workKind: input.kind,
    subjectProfile: input.subject,
    subjectName: input.subjectName,
    language: input.language,
    pages: input.pages,
    university: input.university,
    faculty: input.faculty,
    department: input.department,
    group: input.group,
    course: input.course,
    author: input.author,
    teacher: input.teacher,
    teacherDegree: input.teacherDegree,
    city: input.city,
    ministry: input.ministry,
    ministryCustom: input.ministryCustom,
    tocMethod: input.tocMethod,
    tocText: input.tocText,
    includeVisuals: input.includeVisuals,
    figureCount: input.figureCount,
    figureKinds: input.figureKinds,
    tableCount: input.tableCount,
    userFacts: input.userFacts,
    userRefs: input.userRefs.map(userRefRowOf),
    refsMin: input.refsMin,
    extra: input.extra,
    fileName: typeof values.fileName === "string" ? values.fileName : base.fileName,
    sourceText: input.sourceText,
  };
}

/** Forma holati → yuboriladigan `FormValues` — `encodeWorkValues` bitta manba. */
function toValues(ui: Ui, genre: WorkGenreId): FormValues {
  const userRefs: ArticleUserRef[] = ui.userRefs
    .map((r, i): ArticleUserRef | null => {
      if (r.mode === "doi") {
        const doi = r.doi.trim();
        return doi ? { id: `u${i + 1}`, doi } : null;
      }
      if (r.mode === "isbn") {
        const isbn = r.isbn.trim();
        return isbn ? { id: `u${i + 1}`, isbn } : null;
      }
      const raw = r.raw.trim();
      return raw ? { id: `u${i + 1}`, raw } : null;
    })
    .filter((r): r is ArticleUserRef => Boolean(r));

  const input: WorkInput = {
    topic: ui.topic,
    genre,
    kind: ui.workKind,
    subject: ui.subjectProfile,
    language: ui.language,
    pages: ui.pages,
    university: ui.university,
    faculty: ui.faculty,
    department: ui.department,
    subjectName: ui.subjectName,
    group: ui.group,
    course: ui.course,
    author: ui.author,
    teacher: ui.teacher,
    teacherDegree: ui.teacherDegree,
    city: ui.city,
    ministry: ui.ministry,
    ministryCustom: ui.ministry === "custom" ? ui.ministryCustom : "",
    tocMethod: ui.tocMethod,
    tocText: ui.tocText,
    outline: parseWorkOutline(ui.tocText),
    includeVisuals: ui.includeVisuals,
    figureCount: ui.includeVisuals ? ui.figureCount : 0,
    figureKinds: ui.figureKinds,
    tableCount: ui.includeVisuals ? ui.tableCount : 0,
    userFacts: ui.userFacts,
    sourceText: ui.sourceText,
    userRefs,
    refsMin: ui.refsMin,
    extra: ui.extra,
  };

  const out = encodeWorkValues(input);
  if (ui.fileName) out.fileName = ui.fileName;
  return out;
}

export function WorkComposer({
  tool,
  profile,
  user,
}: {
  tool: ToolConfig;
  profile: UserProfile;
  user: ServerUser | null;
}) {
  void user;
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const genre: WorkGenreId = workGenreOfTool(tool.id) ?? "coursework";
  const [ui, setUi] = useState<Ui>(() => emptyUi(profile, tool, genre));
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s, genre));
    // `genre` — vosita (`tool.id`) bilan bir marta hisoblanadi, mount paytida yetarli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui, genre));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));

  const kind: WorkKind = workKindOf(genre, ui.workKind);
  const subjProfile = SUBJECT_PROFILES[ui.subjectProfile];

  function onWorkKindChange(id: string) {
    const nextKind = workKindOf(genre, id);
    setUi((s) => ({
      ...s,
      workKind: nextKind.id,
      pages: normalizeWorkPages(nextKind, s.pages),
      refsMin: s.refsMinTouched ? s.refsMin : nextKind.refsMin,
    }));
  }
  function onSubjectProfileChange(id: string) {
    const next = SUBJECT_PROFILES[id as SubjectProfileId] ?? SUBJECT_PROFILES.humanities;
    setUi((s) => ({
      ...s,
      subjectProfile: next.id,
      figureCount: s.visualsTouched ? s.figureCount : next.defaultVisuals.figures,
      tableCount: s.visualsTouched ? s.tableCount : next.defaultVisuals.tables,
    }));
  }
  function onMinistryChange(id: string) {
    set("ministry", (id === "maktab" ? "maktab" : id === "custom" ? "custom" : "oliy") as WorkMinistryId);
  }

  const subjectNameSuggest = (q: string) => {
    const query = q.trim().toLowerCase();
    return SUBJECT_NAME_SUGGESTIONS.filter((s) => !query || s.toLowerCase().includes(query))
      .slice(0, 6)
      .map((s) => ({ id: s, label: s }));
  };

  const outline = ui.tocMethod === "manual" ? parseWorkOutline(ui.tocText) : [];
  const outlineParagraphs = outline.reduce((n, c) => n + c.paragraphs.length, 0);

  const values = toValues(ui, genre);
  const price = priceFor(tool, values);
  const visualsCap = maxVisualsFor(ui.pages);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(profile, tool, genre));
  });

  async function submit() {
    setError(null);
    if (!ui.topic.trim()) {
      setError("Mavzuni kiriting");
      return;
    }
    if (!ui.university.trim()) {
      setError("Oliy ta'lim muassasasi to‘ldirilishi kerak");
      return;
    }
    if (!ui.author.trim()) {
      setError("Muallif (F.I.Sh.) to‘ldirilishi kerak");
      return;
    }
    setLoading(true);
    flush();
    try {
      const v = toValues(ui, genre);
      const id = await runGeneration(tool, v);
      const patch = profilePatchFrom(
        { author: ui.author, subject: ui.subjectName, position: profile.position, organization: profile.organization },
        profile,
      );
      if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
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
              <button key={ex} type="button" onClick={() => set("topic", ex)} className="bg-muted hover:bg-muted/70 rounded-md px-2 py-1 text-left text-[11px]">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        <Row label="Tur" hint={kind.hint} wide>
          <span data-field="workKind" className="block">
            <Segmented ariaLabel="Tur" options={workKindsOf(genre).map((k) => ({ value: k.id, label: k.label.uz }))} value={ui.workKind} onChange={onWorkKindChange} />
          </span>
        </Row>
        <Row label="Fan profili" hint={subjProfile.hint} wide>
          <span data-field="subjectProfile" className="block">
            <Segmented
              ariaLabel="Fan profili"
              options={SUBJECT_PROFILE_LIST.map((p) => ({ value: p.id, label: p.label.uz }))}
              value={ui.subjectProfile}
              onChange={onSubjectProfileChange}
            />
          </span>
        </Row>
        <Row label="Fan nomi" hint="Masalan: Pedagogika, Iqtisodiyot nazariyasi">
          <span data-field="subjectName" className="block">
            <Combobox ariaLabel="Fan nomi" value={ui.subjectName} onChange={(v) => set("subjectName", v)} suggest={subjectNameSuggest} placeholder="Fan nomi" />
          </span>
        </Row>
      </Card>

      <details open className="bg-card mb-3 rounded-2xl border p-4">
        <summary className="mb-1 cursor-pointer text-[11.5px] font-semibold tracking-wide uppercase">
          <span className="text-muted-foreground">Titul</span>
        </summary>
        <div className="mt-2">
          <Row label="OTM">
            <span data-field="university" className="block">
              <TextInput value={ui.university} onChange={(v) => set("university", v)} placeholder="Toshkent davlat universiteti" />
            </span>
          </Row>
          <Row label="Fakultet">
            <span data-field="faculty" className="block">
              <TextInput value={ui.faculty} onChange={(v) => set("faculty", v)} placeholder="Fakultet nomi" />
            </span>
          </Row>
          <Row label="Kafedra">
            <span data-field="department" className="block">
              <TextInput value={ui.department} onChange={(v) => set("department", v)} placeholder="Kafedra nomi" />
            </span>
          </Row>
          <Row label="Guruh">
            <span data-field="group" className="block">
              <TextInput value={ui.group} onChange={(v) => set("group", v)} placeholder="301-guruh" />
            </span>
          </Row>
          <Row label="Kurs">
            <span data-field="course" className="block">
              <TextInput value={ui.course} onChange={(v) => set("course", v)} placeholder="3" />
            </span>
          </Row>
          <Row label="Muallif">
            <span data-field="author" className="block">
              <TextInput value={ui.author} onChange={(v) => set("author", v)} placeholder="F.I.Sh." />
            </span>
          </Row>
          <Row label="O‘qituvchi" wide>
            <div className="grid gap-2 sm:grid-cols-2">
              <span data-field="teacher" className="block">
                <TextInput value={ui.teacher} onChange={(v) => set("teacher", v)} placeholder="F.I.Sh." />
              </span>
              <span data-field="teacherDegree" className="block">
                <TextInput value={ui.teacherDegree} onChange={(v) => set("teacherDegree", v)} placeholder="Unvon / ilmiy daraja" />
              </span>
            </div>
          </Row>
          <Row label="Shahar">
            <span data-field="city" className="block">
              <TextInput value={ui.city} onChange={(v) => set("city", v)} placeholder="Toshkent" />
            </span>
          </Row>
          <Row label="Vazirlik" wide>
            <span data-field="ministry" className="block">
              <Segmented ariaLabel="Vazirlik" options={MINISTRY_OPTIONS} value={ui.ministry} onChange={onMinistryChange} />
            </span>
          </Row>
          <div className={ui.ministry === "custom" ? "" : "hidden"}>
            <Row label="Vazirlik nomi" wide>
              <span data-field="ministryCustom" className="block">
                <TextInput
                  value={ui.ministryCustom}
                  onChange={(v) => set("ministryCustom", v)}
                  placeholder="O'ZBEKISTON RESPUBLIKASI RAQAMLI TEXNOLOGIYALAR VAZIRLIGI"
                />
              </span>
            </Row>
          </div>
        </div>
      </details>

      <Card title="Hajm va til">
        <Row label="Hajm" hint={`Kirish: ${fmtNum(kind.introShare[0] * 100)}–${fmtNum(kind.introShare[1] * 100)} %, xulosa: ${fmtNum(kind.conclusionPages[0])}–${fmtNum(kind.conclusionPages[1])} bet`}>
          <span data-field="pages" className="block">
            <Segmented ariaLabel="Hajm" options={kind.pages.map((id) => ({ value: id, label: `${pagesLabel(id)} · ${formatTanga(priceFor(tool, { pages: id }))}` }))} value={ui.pages} onChange={(v) => set("pages", v)} />
          </span>
        </Row>
        <Row label="Til">
          <span data-field="language" className="block">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v as Ui["language"])} />
          </span>
        </Row>
      </Card>

      <Card title="Reja">
        <Row label="Reja usuli" wide>
          <span data-field="tocMethod" className="block">
            <Segmented
              ariaLabel="Reja usuli"
              options={[
                { value: "ai", label: "Avto (AI)" },
                { value: "manual", label: "O'zim yozaman" },
              ]}
              value={ui.tocMethod}
              onChange={(v) => set("tocMethod", v as Ui["tocMethod"])}
            />
          </span>
        </Row>
        <div className={ui.tocMethod === "manual" ? "" : "hidden"}>
          <Row label="Reja matni" wide>
            <span data-field="tocText" className="block">
              <TextArea
                value={ui.tocText}
                onChange={(v) => set("tocText", v)}
                placeholder={"1-BOB. Nazariy asoslar\n1.1. Tushuncha\n1.2. Yondashuvlar\n2-BOB. Amaliy tahlil\n2.1. Natijalar"}
              />
            </span>
            <p className="text-muted-foreground mt-1 text-[11px]" data-outline-summary>
              {outline.length} bob, {outlineParagraphs} paragraf
            </p>
          </Row>
        </div>
      </Card>

      <Card title="Materiallar">
        <div data-field="sourceText" data-source-file>
          <SourceFileField
            legend="Hujjat yuklang (ixtiyoriy)"
            fileName={ui.fileName}
            sourceText={ui.sourceText}
            onChange={({ fileName, sourceText }) => setUi((s) => ({ ...s, fileName, sourceText }))}
            onBusyChange={setFileBusy}
          />
        </div>
        <Row label="Natijalarim" hint="AI faqat shu faktlarga tayanadi" wide>
          <span data-field="userFacts" className="block">
            <TextArea value={ui.userFacts} onChange={(v) => set("userFacts", v)} placeholder="Tajribada 120 o'quvchi qatnashdi, o'rtacha ball 4,1 dan 4,6 ga oshdi." />
          </span>
        </Row>
        <Row label="Mening manbalarim" wide>
          <span data-field="userRefs" className="block">
            <RowList
              name="userRefs"
              rows={ui.userRefs}
              onChange={(rows) => set("userRefs", rows)}
              max={40}
              addLabel="Manba"
              empty="DOI, ISBN yoki erkin matnli manba qo‘shing."
              add={() => ({ mode: "doi" as const, doi: "", isbn: "", raw: "" })}
              render={(row, set2) => (
                <div className="flex flex-col gap-1.5">
                  <Segmented
                    ariaLabel="Manba turi"
                    options={[
                      { value: "doi", label: "DOI" },
                      { value: "isbn", label: "ISBN" },
                      { value: "text", label: "Matn" },
                    ]}
                    value={row.mode}
                    onChange={(v) => set2({ mode: v as UserRefRow["mode"] })}
                  />
                  {row.mode === "doi" ? (
                    <TextInput value={row.doi} onChange={(v) => set2({ doi: v })} placeholder="10.1186/s40561-023-00260-y" />
                  ) : row.mode === "isbn" ? (
                    <TextInput value={row.isbn} onChange={(v) => set2({ isbn: v })} placeholder="978-0-13-468599-1" />
                  ) : (
                    <TextArea value={row.raw} onChange={(v) => set2({ raw: v })} placeholder="Karimov A. Pedagogika. — Toshkent: Fan, 2022." />
                  )}
                </div>
              )}
            />
          </span>
        </Row>
        <Row label="Manba minimumi" hint={`Standart: ${genre === "coursework" ? "kurs ishi ≥15" : genre === "referat" ? "referat ≥5" : "mustaqil ish ≥8"}`}>
          <span data-field="refsMin" className="block">
            <TextInput
              type="number"
              value={String(ui.refsMin)}
              onChange={(v) => setUi((s) => ({ ...s, refsMin: Math.max(0, Math.min(40, Number(v) || 0)), refsMinTouched: true }))}
            />
          </span>
        </Row>
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
                kind.label.uz,
                subjProfile.label.uz,
                pagesLabel(ui.pages),
                ui.includeVisuals ? (ui.figureKinds.length ? `sxema: ${ui.figureKinds.map((k) => FIGURE_KIND_LABEL[k].toLowerCase()).join(", ")}` : `${ui.figureCount} sxema, ${ui.tableCount} jadval`) : "vizualsiz",
              ].filter(Boolean)}
            />
          ) : null}
        </summary>
        <div className="mt-3">
          <Row label="Vizuallar" hint="Sxema va jadval qo'shilsinmi?">
            <span data-field="includeVisuals" className="block">
              <Switch checked={ui.includeVisuals} onChange={(v) => set("includeVisuals", v)} ariaLabel="Vizuallar" />
            </span>
          </Row>
          <Row label="Sxemalar soni" hint={`Ushbu paketga ${visualsCap} tagacha sig'adi`}>
            <span data-field="figureCount" className="block">
              <Segmented
                ariaLabel="Sxemalar soni"
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                value={String(ui.figureCount)}
                onChange={(v) => setUi((s) => ({ ...s, figureCount: Number(v), visualsTouched: true }))}
              />
            </span>
          </Row>
          <Row label="Sxema turlari" hint={ui.includeVisuals && ui.figureCount ? "Avto — mazmunga qarab; tanlasangiz faqat shu turlar chiziladi" : "Sxema so‘ralmagan"} wide>
            <span data-field="figureKinds" className="block">
              <FigureKindChips value={ui.figureKinds} onChange={(v) => set("figureKinds", v)} disabled={!ui.includeVisuals || ui.figureCount === 0} />
            </span>
          </Row>
          <Row label="Jadvallar soni">
            <span data-field="tableCount" className="block">
              <Segmented
                ariaLabel="Jadvallar soni"
                options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
                value={String(ui.tableCount)}
                onChange={(v) => setUi((s) => ({ ...s, tableCount: Number(v), visualsTouched: true }))}
              />
            </span>
          </Row>
          <Row label="Qo‘shimcha" hint="Modelga alohida talab" wide>
            <span data-field="extra" className="block">
              <TextArea value={ui.extra} onChange={(v) => set("extra", v)} placeholder="Ixtiyoriy" />
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
