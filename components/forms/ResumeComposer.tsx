"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { updateProfile, type ServerUser } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { profilePatchFrom } from "@/lib/profile-sync";
import { searchProfessions, skillsForRole } from "@/lib/professions";
import {
  encodeResumeValues,
  resumeInputFromValues,
  type ResumeInput,
  type ResumeTone,
} from "@/lib/generation/resume/input";
import { RESUME_LIMITS, newRowId } from "@/lib/generation/resume/model";
import { RESUME_TEMPLATES, normalizeResumeTemplate, type ResumePaletteId, type ResumeTemplateId } from "@/lib/generation/resume/templates";
import { SOURCE_LANGUAGES } from "@/lib/languages";
import { Card, Row, SelectField, Segmented, SummaryChips, Switch } from "./compact";
import { TextArea, TextInput } from "./fields";
import { Combobox } from "./Combobox";
import { MonthPicker } from "./MonthPicker";
import { PhoneInput } from "./PhoneInput";
import { PhotoField } from "./PhotoField";
import { ResumeTemplateTile } from "./ResumeTemplateDialog";
import { RowList } from "./RowList";
import { ToolChrome } from "./ToolChrome";
import { useResumeDraft } from "./useResumeDraft";
import { runGeneration } from "./runGeneration";

/**
 * Rezyume formasi (Rezyume 2) — `ResumeWizard` (5 qadamli, erkin matnli)
 * o'rniga.
 *
 * Nega sehrgar emas, bitta sahifa: sehrgarda foydalanuvchi qaysi
 * ma'lumot qayerda ekanini ko'rmasdi va orqaga qaytib tuzatish
 * qiyin edi. Endi Formalar 2 uslubidagi ixcham kartalar, ma'lumot esa
 * TUZILMALI (ish joyi = kompaniya + lavozim + sana + bandlar) — model
 * uni taxmin qilib ajratmaydi.
 *
 * Qoralama serverda saqlanadi (`useResumeDraft`): sahifa yopilib qayta
 * ochilsa hamma narsa joyida turadi.
 */

type Ui = ResumeInput & {
  language: string;
  resumeTemplate: ResumeTemplateId;
  resumePalette: ResumePaletteId;
  enrich: boolean;
  photoAssetId: string;
  photoOriginalAssetId: string;
  /** Surat qaysi shaklda kesilgan — shablon o'zgarganda mos kelmasligini ko'rsatish uchun. */
  photoShape?: "circle" | "square";
  /** Ta'lim/sertifikat/til bloklari ochiqmi — yopiq blok `[]` yuboradi. */
  show: { education: boolean; certificates: boolean; languages: boolean; links: boolean };
};

const LANG_OPTIONS = SOURCE_LANGUAGES.map((l) => ({ value: l.value, label: l.label }));
const TONE_OPTIONS: { value: ResumeTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "qisqa", label: "Qisqa" },
  { value: "ijodiy", label: "Ijodiy" },
];
const LINK_KINDS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "github", label: "GitHub" },
  { value: "portfolio", label: "Portfolio" },
  { value: "other", label: "Boshqa" },
];

function emptyUi(profile: UserProfile, user: ServerUser | null): Ui {
  return {
    identity: { fullName: profile.author || "", headline: "" },
    contact: { phone: user?.phone ? `+${String(user.phone).replace(/\D/g, "")}` : "", email: "", location: profile.city || "Toshkent" },
    experience: [],
    education: [],
    certificates: [],
    languages: [],
    skills: [],
    links: [],
    about: "",
    tone: "professional",
    extra: "",
    language: "uz",
    resumeTemplate: "modern",
    resumePalette: RESUME_TEMPLATES.modern.defaultPalette,
    enrich: true,
    photoAssetId: "",
    photoOriginalAssetId: "",
    show: { education: true, certificates: false, languages: false, links: false },
  };
}

/** Qoralamadagi `FormValues` → forma holati (kirish qatlami bilan bir manba). */
function uiFromValues(values: FormValues, base: Ui): Ui {
  const input = resumeInputFromValues(values);
  const template = normalizeResumeTemplate(values.resumeTemplate);
  return {
    ...base,
    ...input,
    language: typeof values.language === "string" && values.language ? values.language : base.language,
    resumeTemplate: template,
    resumePalette: (typeof values.resumePalette === "string" ? values.resumePalette : "") as ResumePaletteId || RESUME_TEMPLATES[template].defaultPalette,
    enrich: values.enrich !== false,
    photoAssetId: typeof values.photoAssetId === "string" ? values.photoAssetId : "",
    photoOriginalAssetId: typeof values.photoOriginalAssetId === "string" ? values.photoOriginalAssetId : "",
    photoShape: values.photoShape === "square" || values.photoShape === "circle" ? values.photoShape : undefined,
    show: {
      education: input.education.length > 0 || base.show.education,
      certificates: input.certificates.length > 0,
      languages: input.languages.length > 0,
      links: input.links.length > 0,
    },
  };
}

function toValues(ui: Ui): FormValues {
  // Yopiq blok ma'lumoti holatda qoladi, lekin YUBORILMAYDI — foydalanuvchi
  // tumblerni qaytarsa yozganlari yo'qolmasin.
  const input: ResumeInput = {
    ...ui,
    education: ui.show.education ? ui.education : [],
    certificates: ui.show.certificates ? ui.certificates : [],
    languages: ui.show.languages ? ui.languages : [],
    links: ui.show.links ? ui.links : [],
  };
  return {
    ...encodeResumeValues(input),
    topic: ui.identity.headline,
    language: ui.language,
    resumeTemplate: ui.resumeTemplate,
    resumePalette: ui.resumePalette,
    enrich: ui.enrich,
    photoAssetId: ui.photoAssetId,
    /*
     * Bu ikkisi dvigatelga KERAK EMAS (worker suratni `photoAssetId` dan
     * oladi) — ular qoralamaga yoziladi, ya'ni forma qayta ochilganda
     * «Markazlash» asl nusxani topadi va shakl mosligi tekshiriladi.
     */
    photoOriginalAssetId: ui.photoOriginalAssetId,
    ...(ui.photoShape ? { photoShape: ui.photoShape } : {}),
  };
}

export function ResumeComposer({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(() => emptyUi(profile, user));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useResumeDraft(loggedIn);

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
  const template = RESUME_TEMPLATES[ui.resumeTemplate];

  const roleSuggest = useMemo(
    () => (q: string) => searchProfessions(q, 8).map((m) => ({ id: m.id, label: m.label })),
    [],
  );
  const skillSuggest = useMemo(() => {
    const fromRole = skillsForRole(ui.identity.headline);
    return (q: string) => {
      const query = q.trim().toLowerCase();
      const pool = [...fromRole, ...searchProfessions(q, 3).flatMap((m) => m.skills)];
      const seen = new Set<string>();
      return pool
        .filter((s) => {
          const k = s.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return !query || k.includes(query);
        })
        .slice(0, 8)
        .map((s) => ({ id: s, label: s }));
    };
  }, [ui.identity.headline]);

  async function submit() {
    setError(null);
    if (!ui.identity.fullName.trim() || !ui.identity.headline.trim()) {
      setError("Ism va maqsadli lavozim kiritilishi shart");
      return;
    }
    setLoading(true);
    flush();
    try {
      const values = toValues(ui);
      const id = await runGeneration(tool, values);
      // Muallif va shahar profilga saqlanadi — keyingi safar tayyor keladi.
      const patch = profilePatchFrom({ author: ui.identity.fullName }, profile);
      if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome
      title={tool.pageTitle}
      submitLabel={tool.submitLabel}
      price={tool.basePrice}
      loading={loading}
      onSubmit={submit}
      error={error}
    >
      <Card title="Shaxsiy" aside={<span className="text-muted-foreground text-[11px]">3 000 tanga · hammasi kiritilgan</span>}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Row label="F.I.Sh">
            <span data-field="fullName" className="block">
              <TextInput
                value={ui.identity.fullName}
                onChange={(v) => set("identity", { ...ui.identity, fullName: v })}
                placeholder="Karimova Dilnoza"
              />
            </span>
          </Row>
          <Row label="Telefon">
            <span data-field="phone" className="block">
              <PhoneInput value={ui.contact.phone} onChange={(v) => set("contact", { ...ui.contact, phone: v })} />
            </span>
          </Row>
          <Row label="Email">
            <span data-field="email" className="block">
              <TextInput
                value={ui.contact.email}
                onChange={(v) => set("contact", { ...ui.contact, email: v })}
                placeholder="ism@mail.uz"
              />
            </span>
          </Row>
          <Row label="Shahar">
            <span data-field="location" className="block">
              <TextInput
                value={ui.contact.location}
                onChange={(v) => set("contact", { ...ui.contact, location: v })}
                placeholder="Toshkent"
              />
            </span>
          </Row>
          <Row label="Surat" hint="Doira yoki kvadrat — tanlangan shablonga qarab kesiladi" wide>
            <span data-field="photoAssetId" className="block">
              <span data-field="photoCrop" hidden />
              <PhotoField
                assetId={ui.photoAssetId}
                originalAssetId={ui.photoOriginalAssetId}
                crop={ui.photoCrop}
                shape={template.photo.shape}
                savedShape={ui.photoShape}
                onChange={(v) =>
                  setUi((s) => ({ ...s, photoAssetId: v.assetId, photoOriginalAssetId: v.originalAssetId, photoCrop: v.crop, photoShape: v.shape }))
                }
              />
            </span>
            {ui.photoAssetId && !template.photoDefault ? (
              <p className="text-muted-foreground mt-1 text-[11px]">
                «{template.title}» shabloni suratsiz maket — surat faqat siz qo‘shsangiz chiziladi.
              </p>
            ) : null}
          </Row>
        </div>
      </Card>

      <Card title="Maqsad">
        <Row label="Lavozim" hint="Yozing — mos kasblar tavsiya qilinadi (uz/ru/en)">
          <span data-field="targetRole" className="block">
            <Combobox
              ariaLabel="Maqsadli lavozim"
              value={ui.identity.headline}
              onChange={(v) => set("identity", { ...ui.identity, headline: v })}
              suggest={roleSuggest}
              placeholder="Moliya tahlilchisi"
            />
          </span>
        </Row>
        <Row label="Chiqish tili" hint="Ma'lumotni istalgan tilda kiriting — rezyume shu tilda yoziladi">
          <span data-field="language" className="block">
            <SelectField ariaLabel="Chiqish tili" options={LANG_OPTIONS} value={ui.language} onChange={(v) => set("language", v)} />
          </span>
        </Row>
        <Row label="Shablon" wide>
          <span data-field="resumeTemplate" className="block">
            <span data-field="resumePalette" hidden />
            <ResumeTemplateTile
              template={ui.resumeTemplate}
              palette={ui.resumePalette}
              withPhoto={Boolean(ui.photoAssetId)}
              onChange={(t, p) => setUi((s) => ({ ...s, resumeTemplate: t, resumePalette: p }))}
            />
          </span>
        </Row>
        <Row label="AI boyitish" hint="Lavozimga xos vazifa va ko'nikmalar qo'shiladi; ish beruvchi, sana va diplom hech qachon o'ylab topilmaydi">
          <span data-field="enrich" className="block">
            <Switch checked={ui.enrich} onChange={(v) => set("enrich", v)} ariaLabel="AI bilan boyitish" />
          </span>
        </Row>
      </Card>

      <Card title="Ish tajribasi">
        <span data-field="experience" className="block">
          <RowList
            name="experience"
            rows={ui.experience}
            onChange={(rows) => set("experience", rows)}
            max={RESUME_LIMITS.experience}
            addLabel="Ish joyi"
            empty="Ish joyi qo‘shing — kompaniya, lavozim, muddat va nima qilganingiz."
            add={() => ({ id: newRowId("e", ui.experience.length), company: "", role: "", start: "", end: "", bullets: [] })}
            render={(row, set2) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <TextInput value={row.company} onChange={(v) => set2({ company: v })} placeholder="Kompaniya" />
                <Combobox
                  ariaLabel="Lavozim"
                  value={row.role}
                  onChange={(v) => set2({ role: v })}
                  suggest={roleSuggest}
                  placeholder="Lavozim"
                />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <MonthPicker label="Boshlanish" value={row.start} onChange={(v) => set2({ start: v })} />
                  <span className="text-muted-foreground text-[12px]">—</span>
                  <MonthPicker label="Tugash" value={row.end} onChange={(v) => set2({ end: v })} allowNow />
                </div>
                <div className="sm:col-span-2">
                  <TextArea
                    value={row.bullets.map((b) => b.text).join("\n")}
                    onChange={(v) =>
                      set2({
                        bullets: v
                          .split("\n")
                          .map((t) => t.trim())
                          .filter(Boolean)
                          .slice(0, RESUME_LIMITS.bullets)
                          .map((text) => ({ text })),
                      })
                    }
                    placeholder={"Har qatorda bitta vazifa yoki natija:\nOylik hisobotni 3 kundan 1 kunga qisqartirdim"}
                  />
                </div>
              </div>
            )}
          />
        </span>
      </Card>

      <Card title="Ta'lim · Sertifikat · Tillar">
        <Toggle
          label="Ta'lim"
          field="education"
          on={ui.show.education}
          onToggle={(v) => set("show", { ...ui.show, education: v })}
        >
          <RowList
            name="education"
            rows={ui.education}
            onChange={(rows) => set("education", rows)}
            max={RESUME_LIMITS.education}
            addLabel="Ta'lim"
            add={() => ({ id: newRowId("d", ui.education.length), institution: "", degree: "", start: "", end: "" })}
            render={(row, set2) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <TextInput value={row.institution} onChange={(v) => set2({ institution: v })} placeholder="Muassasa" />
                <TextInput value={row.degree} onChange={(v) => set2({ degree: v })} placeholder="Yo‘nalish, daraja" />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                  <MonthPicker label="Boshlanish" value={row.start} onChange={(v) => set2({ start: v })} />
                  <span className="text-muted-foreground text-[12px]">—</span>
                  <MonthPicker label="Tugash" value={row.end} onChange={(v) => set2({ end: v })} allowNow />
                </div>
              </div>
            )}
          />
        </Toggle>
        <Toggle
          label="Sertifikatlar"
          field="certificates"
          on={ui.show.certificates}
          onToggle={(v) => set("show", { ...ui.show, certificates: v })}
        >
          <RowList
            name="certificates"
            rows={ui.certificates}
            onChange={(rows) => set("certificates", rows)}
            max={RESUME_LIMITS.certificates}
            addLabel="Sertifikat"
            add={() => ({ id: newRowId("c", ui.certificates.length), name: "", issuer: "", year: "" })}
            render={(row, set2) => (
              <div className="grid gap-2 sm:grid-cols-3">
                <TextInput value={row.name} onChange={(v) => set2({ name: v })} placeholder="Nomi" />
                <TextInput value={row.issuer} onChange={(v) => set2({ issuer: v })} placeholder="Kim bergan" />
                <TextInput value={row.year} onChange={(v) => set2({ year: v })} placeholder="Yil" />
              </div>
            )}
          />
        </Toggle>
        <Toggle
          label="Tillar"
          field="languages"
          on={ui.show.languages}
          onToggle={(v) => set("show", { ...ui.show, languages: v })}
        >
          <RowList
            name="languages"
            rows={ui.languages}
            onChange={(rows) => set("languages", rows)}
            max={RESUME_LIMITS.languages}
            addLabel="Til"
            add={() => ({ id: newRowId("l", ui.languages.length), language: "", level: "" })}
            render={(row, set2) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <TextInput value={row.language} onChange={(v) => set2({ language: v })} placeholder="Ingliz tili" />
                <TextInput value={row.level} onChange={(v) => set2({ level: v })} placeholder="B2 / erkin" />
              </div>
            )}
          />
        </Toggle>
      </Card>

      <Card title="Ko'nikmalar" aside={<span className="text-muted-foreground text-[11px]">{ui.skills.length} ta</span>}>
        <span data-field="skills" className="block">
          <Combobox
            multi
            ariaLabel="Ko'nikmalar"
            value={ui.skills}
            onChange={(v) => set("skills", v)}
            suggest={skillSuggest}
            max={RESUME_LIMITS.skills}
            placeholder="Excel, 1C, IFRS…"
          />
        </span>
        <p className="text-muted-foreground mt-1.5 text-[11px]">
          Lavozimni tanlasangiz, shu kasbga xos ko‘nikmalar tavsiya qilinadi.
        </p>
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
                TONE_OPTIONS.find((t) => t.value === ui.tone)?.label ?? "",
                ui.about ? "o‘zi haqida bor" : "",
                ui.links.length ? `${ui.links.length} havola` : "",
              ].filter(Boolean)}
            />
          ) : null}
        </summary>
        <div className="mt-3">
          <Row label="Uslub">
            <span data-field="tone" className="block">
              <Segmented ariaLabel="Uslub" options={TONE_OPTIONS} value={ui.tone} onChange={(v) => set("tone", v as ResumeTone)} />
            </span>
          </Row>
          <Row label="O'zingiz haqingizda" hint="Ixtiyoriy — model qisqacha bo'limni shundan yozadi" wide>
            <span data-field="about" className="block">
              <TextArea value={ui.about} onChange={(v) => set("about", v.slice(0, 400))} placeholder="5 yil moliya sohasida, byudjet va hisobot bilan ishlaganman" />
            </span>
          </Row>
          <Row label="Havolalar" wide>
            <span data-field="links" className="block">
              <Toggle label="Havolalar" field="links" on={ui.show.links} onToggle={(v) => set("show", { ...ui.show, links: v })}>
                <RowList
                  name="links"
            rows={ui.links}
                  onChange={(rows) => set("links", rows)}
                  max={RESUME_LIMITS.links}
                  addLabel="Havola"
                  add={() => ({ id: newRowId("k", ui.links.length), kind: "portfolio" as const, url: "" })}
                  render={(row, set2) => (
                    <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                      <SelectField
                        ariaLabel="Havola turi"
                        options={LINK_KINDS}
                        value={row.kind}
                        onChange={(v) => set2({ kind: v as typeof row.kind })}
                      />
                      <TextInput value={row.url} onChange={(v) => set2({ url: v })} placeholder="https://" />
                    </div>
                  )}
                />
              </Toggle>
            </span>
          </Row>
          <Row label="Qo'shimcha" hint="Modelga alohida talab («harbiy xizmatni yozmang»)" wide>
            <span data-field="extra" className="block">
              <TextArea value={ui.extra} onChange={(v) => set("extra", v)} placeholder="Ixtiyoriy" />
            </span>
          </Row>
          <div className="mt-2">
            <ClearButton
              onClear={() => {
                void clear();
                setUi(emptyUi(profile, user));
              }}
            />
          </div>
        </div>
      </details>
    </ToolChrome>
  );
}

/** Tumbler bilan ochiladigan blok: yopiq bo'lsa ma'lumot yuborilmaydi. */
function Toggle({
  label,
  field,
  on,
  onToggle,
  children,
}: {
  label: string;
  field: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    /*
     * `data-field` tumbler YOPIQ bo'lganda ham turadi: qamrov testi
     * (`tests/viewer/resume-form.test.mts`) parametr formada BOR-YO'Qligini
     * shu bo'yicha o'lchaydi, blok esa foydalanuvchi tanloviga qarab
     * ochiladi.
     */
    <div className="border-b py-2 last:border-b-0" data-toggle={field} data-field={field}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        <Switch checked={on} onChange={onToggle} ariaLabel={label} />
      </div>
      {on ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function ClearButton({ onClear }: { onClear: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          setArmed(false);
          onClear();
        } else setArmed(true);
      }}
      className="text-muted-foreground hover:text-destructive text-[12px]"
    >
      {armed ? "Ishonchingiz komilmi? Yana bosing" : "Formani tozalash"}
    </button>
  );
}
