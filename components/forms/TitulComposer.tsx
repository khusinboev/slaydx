"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { updateProfile } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { profilePatchFrom } from "@/lib/profile-sync";
import { priceFor } from "@/lib/tools";
import { tashkentYear } from "@/lib/generation/tashkent-year";
import {
  TITUL_LAYOUTS_OF,
  TITUL_LAYOUT_LABEL,
  TITUL_LIMITS,
  TITUL_WORK_TYPES,
  TITUL_WORK_TYPE_LABEL,
  type TitulInput,
  type TitulWorkType,
} from "@/lib/generation/title-page/types";
import { encodeTitulValues, titulBorderDefault, titulFieldsOf, titulInputFromValues, titulLayoutFor, type TitulFieldId } from "@/lib/generation/title-page/input";
import { Card, Row, Segmented, SelectField, Switch } from "./compact";
import { TextInput } from "./fields";
import { Field, SettingsDetails, TopicRow } from "./shared";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * «Titul» — the FREE title-page form (owner request: course work, diploma and
 * independent work title pages, free of charge).
 *
 * One parameter — one `Row` with one `data-field` (forms3-etalon §5). The rows
 * shown are exactly `titulFieldsOf(type, layout, ministry)` — a field that
 * would not change this page is not drawn («bezak maydon yo'q»; the probe test
 * `tests/titul-params.test.mts` changes every one and expects the page to
 * change). State is the normalized `TitulInput` itself, so the form, the draft
 * (`useFormDraft` — coming back to the form shows the same values) and the
 * engine read one shape. Prefilled from the saved author profile, as the
 * other student forms; author and subject are written back after «Yaratish».
 */

type Ui = TitulInput & { borderTouched: boolean };

function emptyUi(profile: UserProfile): Ui {
  const input = titulInputFromValues({
    university: profile.university,
    faculty: profile.faculty,
    department: profile.department,
    subject: profile.subject,
    author: profile.author,
    group: profile.group,
    course: profile.course,
    supervisor: profile.teacher,
    city: profile.city,
    year: tashkentYear(),
  });
  return { ...input, borderTouched: false };
}

const LANG_OPTIONS = [
  { value: "uz", label: "O‘zbek (lotin)" },
  { value: "uz-cyrl", label: "Ўзбек (кирилл)" },
  { value: "ru", label: "Русский" },
];
const MINISTRY_OPTIONS = [
  { value: "oliy", label: "Oliy ta’lim" },
  { value: "maktab", label: "Maktab ta’limi" },
  { value: "custom", label: "O‘zim yozaman" },
  { value: "none", label: "Yo‘q" },
];
const CHECKER_OPTIONS = [
  { value: "accepted", label: "Qabul qildi" },
  { value: "checked", label: "Tekshirdi" },
  { value: "supervisor", label: "Ilmiy rahbar" },
];
const APPROVER_OPTIONS = [
  { value: "dean", label: "Fakultet dekani" },
  { value: "head", label: "Kafedra mudiri" },
];
const LAB_OPTIONS = [
  { value: "lab", label: "Laboratoriya ishi" },
  { value: "practical", label: "Amaliy ish" },
];

/** Text rows: label, placeholder, cap. */
const TEXT_ROWS: Partial<Record<TitulFieldId, { label: string; placeholder: string; max: number; hint?: string }>> = {
  university: { label: "OTM", placeholder: "Toshkent davlat universiteti", max: TITUL_LIMITS.university },
  faculty: { label: "Fakultet", placeholder: "Kompyuter injiniringi", max: TITUL_LIMITS.faculty },
  department: { label: "Kafedra", placeholder: "Axborot xavfsizligi", max: TITUL_LIMITS.department },
  subject: { label: "Fan", placeholder: "Dasturlash asoslari", max: TITUL_LIMITS.subject },
  author: { label: "Muallif", placeholder: "Aliyev V.", max: TITUL_LIMITS.name, hint: "Bo‘sh qolsa — qo‘lda yozish uchun chiziq qoladi" },
  group: { label: "Guruh", placeholder: "912-21", max: TITUL_LIMITS.group },
  course: { label: "Kurs", placeholder: "3", max: TITUL_LIMITS.course },
  direction: { label: "Yo‘nalish", placeholder: "Kompyuter injiniringi", max: TITUL_LIMITS.direction },
  directionCode: { label: "Yo‘nalish kodi", placeholder: "60610100", max: TITUL_LIMITS.directionCode },
  supervisor: { label: "O‘qituvchi", placeholder: "Karimov B.", max: TITUL_LIMITS.name, hint: "Bo‘sh qolsa — imzo uchun chiziq qoladi" },
  supervisorRole: { label: "Lavozim / daraja", placeholder: "katta o‘qituvchi", max: TITUL_LIMITS.role },
  approver: { label: "Ruxsat beruvchi", placeholder: "Rahimov S.", max: TITUL_LIMITS.name },
  reviewer: { label: "Taqrizchi", placeholder: "dotsent Yusupov A.", max: TITUL_LIMITS.name + TITUL_LIMITS.role },
  udk: { label: "UDK", placeholder: "004.8", max: TITUL_LIMITS.udk },
  specialityCode: { label: "Mutaxassislik kodi", placeholder: "70610101", max: TITUL_LIMITS.specialityCode },
  speciality: { label: "Mutaxassislik", placeholder: "Axborot xavfsizligi", max: TITUL_LIMITS.speciality },
  labNumber: { label: "Ish raqami", placeholder: "3", max: TITUL_LIMITS.labNumber },
  city: { label: "Shahar", placeholder: "Toshkent", max: TITUL_LIMITS.city },
};

function toValues(ui: Ui): FormValues {
  const { borderTouched: _touched, ...input } = ui;
  void _touched;
  return encodeTitulValues(input);
}

export function TitulComposer({ tool, profile }: { tool: ToolConfig; profile: UserProfile }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [ui, setUi] = useState<Ui>(() => emptyUi(profile));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, flush } = useFormDraft(tool.id, { enabled: loggedIn });
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi({ ...titulInputFromValues(draft), borderTouched: true });
  }, [ready, draft, restored]);

  useEffect(() => {
    if (restored) save(toValues(ui));
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(k: K, v: Ui[K]) => setUi((s) => ({ ...s, [k]: v }));
  /** Type / layout change: the layout follows the type, the border default follows the layout until the user touched it. */
  const setShape = (workType: TitulWorkType, layoutRaw: string) =>
    setUi((s) => {
      const layout = titulLayoutFor(workType, layoutRaw);
      return { ...s, workType, layout, border: s.borderTouched ? s.border : titulBorderDefault(layout) };
    });

  const shown = new Set(titulFieldsOf(ui.workType, ui.layout, ui.ministry));
  const values = toValues(ui);
  const price = priceFor(tool, values);

  const textRow = (id: TitulFieldId) => {
    const meta = TEXT_ROWS[id];
    if (!meta || !shown.has(id)) return null;
    return (
      <Row key={id} label={meta.label} hint={meta.hint}>
        <Field id={id}>
          <TextInput value={String(ui[id] ?? "")} onChange={(v) => set(id, v.slice(0, meta.max) as never)} placeholder={meta.placeholder} />
        </Field>
      </Row>
    );
  };

  async function submit() {
    setError(null);
    if (!ui.topic.trim()) {
      setError("Mavzuni kiriting");
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, titulInputValues(ui));
      const patch = profilePatchFrom({ author: ui.author, subject: ui.subject, position: profile.position, organization: profile.organization }, profile);
      if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const layouts = TITUL_LAYOUTS_OF[ui.workType];
  const summary = [LANG_OPTIONS.find((o) => o.value === ui.lang)?.label, MINISTRY_OPTIONS.find((o) => o.value === ui.ministry)?.label, ui.city || "Toshkent", String(ui.year), ui.border ? "ramkali" : "ramkasiz"];

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Ish turi va mavzu">
        <Row label="Ish turi">
          <Field id="workType">
            <SelectField ariaLabel="Ish turi" options={TITUL_WORK_TYPES.map((t) => ({ value: t, label: TITUL_WORK_TYPE_LABEL[t] }))} value={ui.workType} onChange={(v) => setShape(v as TitulWorkType, ui.layout)} />
          </Field>
        </Row>
        <Row label="Ko‘rinish" hint="Har turga mos maketlar; birinchisi — odatiy" wide>
          <Field id="layout">
            <Segmented ariaLabel="Ko‘rinish" options={layouts.map((l) => ({ value: l, label: TITUL_LAYOUT_LABEL[l] }))} value={ui.layout} onChange={(v) => setShape(ui.workType, v)} />
          </Field>
        </Row>
        {shown.has("labKind") ? (
          <Row label="Ish">
            <Field id="labKind">
              <Segmented ariaLabel="Ish" options={LAB_OPTIONS} value={ui.labKind} onChange={(v) => set("labKind", v as Ui["labKind"])} />
            </Field>
          </Row>
        ) : null}
        {textRow("labNumber")}
        <TopicRow value={ui.topic} onChange={(v) => set("topic", v)} placeholder={tool.topicPlaceholder} limit={TITUL_LIMITS.topic} />
      </Card>

      <Card title="Muassasa">
        {textRow("university")}
        {textRow("faculty")}
        {textRow("department")}
        {textRow("subject")}
      </Card>

      <Card title="Muallif va o‘qituvchi">
        {textRow("author")}
        {textRow("group")}
        {textRow("course")}
        {textRow("direction")}
        {textRow("directionCode")}
        {shown.has("checkerLabel") ? (
          <Row label="Yorliq" wide>
            <Field id="checkerLabel">
              <Segmented ariaLabel="O‘qituvchi yorlig‘i" options={CHECKER_OPTIONS} value={ui.checkerLabel} onChange={(v) => set("checkerLabel", v as Ui["checkerLabel"])} />
            </Field>
          </Row>
        ) : null}
        {textRow("supervisor")}
        {textRow("supervisorRole")}
        {shown.has("approverRole") ? (
          <Row label="Himoyaga ruxsat" wide>
            <Field id="approverRole">
              <Segmented ariaLabel="Himoyaga ruxsat beruvchi" options={APPROVER_OPTIONS} value={ui.approverRole} onChange={(v) => set("approverRole", v as Ui["approverRole"])} />
            </Field>
          </Row>
        ) : null}
        {textRow("approver")}
        {textRow("reviewer")}
        {textRow("udk")}
        {textRow("specialityCode")}
        {textRow("speciality")}
      </Card>

      <SettingsDetails summary={summary}>
        <Row label="Vazirlik" wide>
          <Field id="ministry">
            <Segmented ariaLabel="Vazirlik" options={MINISTRY_OPTIONS} value={ui.ministry} onChange={(v) => set("ministry", v as Ui["ministry"])} />
          </Field>
        </Row>
        {shown.has("ministryCustom") ? (
          <Row label="Vazirlik nomi" wide>
            <Field id="ministryCustom">
              <TextInput value={ui.ministryCustom} onChange={(v) => set("ministryCustom", v.slice(0, TITUL_LIMITS.ministryCustom))} placeholder="O‘ZBEKISTON RESPUBLIKASI RAQAMLI TEXNOLOGIYALAR VAZIRLIGI" />
            </Field>
          </Row>
        ) : null}
        {textRow("city")}
        <Row label="Yil">
          <Field id="year">
            <Segmented ariaLabel="Yil" options={yearOptions(ui.year)} value={String(ui.year)} onChange={(v) => set("year", Number(v))} />
          </Field>
        </Row>
        <Row label="Ramka" hint="Sahifa atrofida qo‘sh chiziqli ramka">
          <Field id="border">
            <Switch checked={ui.border} onChange={(v) => setUi((s) => ({ ...s, border: v, borderTouched: true }))} ariaLabel="Ramka" />
          </Field>
        </Row>
        <Row label="Yorliqlar tili" hint="«Bajardi», «Mavzu» kabi tayyor so‘zlar tili; siz yozgan matn o‘zgarmaydi" wide>
          <Field id="lang">
            <Segmented ariaLabel="Yorliqlar tili" options={LANG_OPTIONS} value={ui.lang} onChange={(v) => set("lang", v as Ui["lang"])} />
          </Field>
        </Row>
      </SettingsDetails>
    </ToolChrome>
  );
}

/** Last year, this year, next year (a restored draft's own year stays selectable). */
function yearOptions(current: number) {
  const now = tashkentYear();
  const years = [...new Set([now - 1, now, now + 1, current])].sort((a, b) => a - b);
  return years.map((y) => ({ value: String(y), label: String(y) }));
}

/** The values sent: only the fields this page uses (hidden ones would be stored but never drawn). */
function titulInputValues(ui: Ui): FormValues {
  const all = toValues(ui);
  const shown = new Set<string>(titulFieldsOf(ui.workType, ui.layout, ui.ministry));
  return Object.fromEntries(Object.entries(all).filter(([k]) => shown.has(k)));
}
