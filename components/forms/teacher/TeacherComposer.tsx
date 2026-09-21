"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ToolConfig, UserProfile } from "@/lib/types";
import { updateProfile, type ServerUser } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { profilePatchFrom } from "@/lib/profile-sync";
import { priceFor } from "@/lib/tools";
import { TEACHER_LIMITS, type TeacherKind } from "@/lib/generation/teacher/types";
import { teacherKindOf, teacherTypeOf } from "@/lib/generation/teacher/registry";
import { teacherParamsOf } from "@/lib/generation/teacher-params";
import { Card, Row } from "../compact";
import { AuthorRows, ClearFormButton, Field, LimitedTextarea, SettingsDetails, TopicRow } from "../shared";
import { TextInput } from "../fields";
import type { CurriculumSelection } from "../CurriculumPicker";
import { ToolChrome } from "../ToolChrome";
import { useFormDraft } from "../useFormDraft";
import { runGeneration } from "../runGeneration";
import { CurriculumRow, DateRow, SubjectGradeLanguage, curriculumSubjectLabel, emptyUi, toValues, uiFromValues, type KindProps, type Ui } from "./common";
import { LessonMain, LessonSettings, lessonApplyType, lessonSummary } from "./LessonFields";
import { MapMain, MapSettings, mapApplyType, mapSummary } from "./MapFields";
import { GlossaryMain, GlossarySettings, glossaryApplyType, glossarySummary } from "./GlossaryFields";
import { KeysMain, KeysSettings, keysApplyType, keysSummary } from "./KeysFields";
import { MODE_LABEL, TestMain, TestModeRow, TestSettings, TestSourceRows, testApplyType, testApproverAllowed, testSummary } from "./TestFields";

/**
 * O'QITUVCHI VOSITALARI — dars rejasi / texnologik xarita / glossariy /
 * keys / test uchun BITTA forma (qobiq).
 *
 * FORMALAR 3 (AUDIT-24 WP-B): eski 831 qatorli fayl bo'lindi —
 * `common.tsx` (holat, umumiy qatorlar) + `{Lesson,Map,Glossary,Keys,
 * Test}Fields.tsx` (kind-xos qatorlar), bu fayl esa faqat QOBIQ:
 * holat, qoralama, profil, submit va kartalar tartibi.
 *
 * Kartalar tartibi (etalon checklist §2, `docs/research/forms3-etalon.md`):
 *   1. Mavzu va rejim    — mavzu/rejim/manba
 *   2. Fan, sinf, til    — fan BITTA manba (`common.tsx` izohi)
 *   3. <kind> asosiy     — tur + hajm (narxga bog'liq bo'lsa shu yerda)
 *   4. Shapka            — muassasa/tuzuvchi (majburiy), tasdiqlovchi, sana
 *   5. ▸ Sozlamalar      — YOPIQ, qolgan kind-qatorlar + qo'shimcha talab
 *
 * Reyestr shartnomasi — `lib/generation/teacher-params.ts`: har
 * `TEACHER_PARAMS` yozuvi shu formada, tegishli KIND mount qilinganda,
 * `data-field={id}` bilan chizilishi SHART (`tests/ui/teacher-composer.
 * test.mts` qamrov testi). Yagona shartli istisno — `approver`: test
 * kindida FAQAT `bsb`/`chsb` turida (dvigatel qolgan turlarda uni jim
 * tashlardi, `forms3-oqituvchi.md` §4-b).
 */

const MAIN_CARD_TITLE: Record<TeacherKind, string> = {
  lesson: "Dars turi va davomiyligi",
  map: "Xarita turi va soatlar",
  glossary: "Glossariy turi va hajmi",
  keys: "Keys turi va soni",
  test: "Test turi va savollar",
};

export function TeacherComposer({
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
  const kind: TeacherKind = teacherKindOf(tool.id) ?? "lesson";
  const own = new Set(teacherParamsOf(kind).map((p) => p.id));

  const [ui, setUi] = useState<Ui>(() => emptyUi(profile, kind));
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s, kind));
    // `kind` — vosita (`tool.id`) bilan bir marta hisoblanadi, mount paytida yetarli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui, kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, restored, save]);

  const set: KindProps["set"] = (key, v) => setUi((s) => ({ ...s, [key]: v }));
  const kindProps: KindProps = { ui, set, setUi, tool };

  const currentType = teacherTypeOf(kind, ui.typeId);

  function onTopicChange(v: string) {
    setUi((s) => ({ ...s, topic: v, subject: kind === "map" && !s.subjectTouched ? v : s.subject }));
  }
  function onSubjectChange(v: string) {
    setUi((s) => ({ ...s, subject: v, subjectTouched: true }));
  }

  /** Tur almashishi — chegaralarni siqish mantig'i kind fayllarida. */
  function onTypeChange(id: string) {
    setUi((s) => {
      if (kind === "lesson") return lessonApplyType(s, id);
      if (kind === "map") return mapApplyType(s, id);
      if (kind === "glossary") return glossaryApplyType(s, id);
      if (kind === "keys") return keysApplyType(s, id);
      return testApplyType(s, id);
    });
  }

  /**
   * O'quv dasturidan fan tanlansa `subject` matni ham to'ladi — FAN
   * BITTA MANBA (ilgari ikkita sinxronlanmagan «Fan» maydoni bor edi).
   */
  function onCurriculumChange(next: CurriculumSelection) {
    setUi((s) => {
      const label = curriculumSubjectLabel(next.subjectId);
      return {
        ...s,
        subjectId: next.subjectId,
        grade: next.grade || s.grade,
        topicIds: next.topicIds,
        subject: next.subjectId && label ? label : s.subject,
      };
    });
  }

  const values = toValues(ui, kind);
  const price = priceFor(tool, values);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(profile, kind));
  });

  async function submit() {
    setError(null);
    const isTest = kind === "test";
    if (isTest && ui.mode === "file") {
      if (!ui.sourceText.trim()) {
        setError("Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi.");
        return;
      }
    } else if (isTest && ui.mode === "curriculum") {
      if (!ui.topicIds.length) {
        setError("Kamida bitta mavzu tanlang");
        return;
      }
    } else if (!ui.topic.trim()) {
      setError(tool.topicLegend ? `${tool.topicLegend}` : "Mavzuni kiriting");
      return;
    }
    if (!ui.university.trim()) {
      setError("Ta'lim muassasasi nomi to'ldirilishi kerak");
      return;
    }
    if (!ui.author.trim()) {
      setError("Tuzuvchi (F.I.Sh) to'ldirilishi kerak");
      return;
    }
    setLoading(true);
    flush();
    try {
      const v = toValues(ui, kind);
      const id = await runGeneration(tool, v);
      const patch = profilePatchFrom({ author: ui.author, subject: ui.subject, position: profile.position, organization: profile.organization }, profile);
      if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  /* ── Karta 3 va ▸ Sozlamalar — kind bo'yicha ── */
  const mainFields =
    kind === "lesson" ? (
      <LessonMain {...kindProps} onTypeChange={onTypeChange} />
    ) : kind === "map" ? (
      <MapMain {...kindProps} onTypeChange={onTypeChange} />
    ) : kind === "glossary" ? (
      <GlossaryMain {...kindProps} onTypeChange={onTypeChange} />
    ) : kind === "keys" ? (
      <KeysMain {...kindProps} onTypeChange={onTypeChange} />
    ) : (
      <TestMain {...kindProps} onTypeChange={onTypeChange} />
    );

  const settingsFields =
    kind === "lesson" ? (
      <LessonSettings {...kindProps} />
    ) : kind === "map" ? (
      <MapSettings {...kindProps} />
    ) : kind === "glossary" ? (
      <GlossarySettings {...kindProps} />
    ) : kind === "keys" ? (
      <KeysSettings {...kindProps} />
    ) : (
      <TestSettings {...kindProps} />
    );

  /** Yopiq «Sozlamalar» chiplari: tur · sinf · hajm · rejim · kind-xos. */
  const sizeChip =
    kind === "lesson"
      ? `${ui.duration} daq`
      : kind === "map"
        ? `${ui.totalHours} soat`
        : kind === "glossary"
          ? `${ui.termCount} atama`
          : kind === "keys"
            ? `${ui.caseCount} keys`
            : `${ui.count} savol`;
  const kindChips =
    kind === "lesson" ? lessonSummary(ui) : kind === "map" ? mapSummary(ui) : kind === "glossary" ? glossarySummary(ui) : kind === "keys" ? keysSummary(ui) : testSummary(ui);
  const summary = [currentType.label.uz, `${ui.grade}-sinf`, sizeChip, kind === "test" ? MODE_LABEL[ui.mode] : "", ...kindChips];

  /**
   * «Tasdiqlayman» — lesson/map da doim (dvigatel saqlaydi), test da
   * FAQAT `bsb`/`chsb` turida (`teacher/test/input.ts` shu ikkitasidan
   * boshqasida qiymatni tashlaydi).
   */
  const showApprover = own.has("approver") && (kind !== "test" || testApproverAllowed(ui.typeId));

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Mavzu va rejim">
        {kind === "test" ? <TestModeRow {...kindProps} /> : null}
        <div className={kind === "test" && ui.mode !== "topic" ? "hidden" : ""}>
          <TopicRow value={ui.topic} onChange={onTopicChange} hint={tool.topicLegend} placeholder={tool.topicPlaceholder} limit={TEACHER_LIMITS.topicChars} />
          {tool.topicExamples?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tool.topicExamples.map((ex) => (
                <button key={ex} type="button" onClick={() => onTopicChange(ex)} className="bg-muted hover:bg-muted/70 rounded-md px-2 py-1 text-left text-[11px]">
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {kind === "test" ? <TestSourceRows {...kindProps} onCurriculumChange={onCurriculumChange} onBusyChange={setFileBusy} /> : null}
        {/*
         * Dars rejasi/xarita: o'quv dasturidan mavzu tanlash IXTIYORIY —
         * fan tanlanmasa (`subjectId` bo'sh) `topicIds` ham bo'sh ketadi.
         */}
        {kind === "lesson" || kind === "map" ? <CurriculumRow ui={ui} onChange={onCurriculumChange} hint="Ixtiyoriy — dastur mavzularidan tanlash" /> : null}
      </Card>

      <Card title="Fan, sinf, til">
        <SubjectGradeLanguage ui={ui} set={set} onSubjectChange={onSubjectChange} subjectHint={kind === "map" ? "Avto — mavzu maydonidan" : undefined} />
      </Card>

      <Card title={MAIN_CARD_TITLE[kind]}>{mainFields}</Card>

      <Card title="Shapka">
        <AuthorRows
          ids={["university", "author"]}
          values={{ university: ui.university, author: ui.author }}
          set={(id, v) => set(id === "university" ? "university" : "author", v)}
          required={["university", "author"]}
          labels={{ university: "Muassasa", author: "Tuzuvchi" }}
        />
        {showApprover ? (
          <Row label="Tasdiqlayman" hint="Lavozim (masalan direktorning o'quv ishlari bo'yicha o'rinbosari)">
            <Field id="approver">
              <TextInput value={ui.approver} onChange={(v) => set("approver", v)} placeholder="Ixtiyoriy" />
            </Field>
          </Row>
        ) : null}
        {own.has("date") ? <DateRow value={ui.date} onChange={(v) => set("date", v)} /> : null}
      </Card>

      <SettingsDetails summary={summary}>
        {own.has("gradeLetter") ? (
          <Row label="Sinf harfi" hint="«5-A» dagi «A» — ixtiyoriy">
            <Field id="gradeLetter">
              <TextInput value={ui.gradeLetter} onChange={(v) => set("gradeLetter", v.slice(0, 1).toUpperCase())} placeholder="A" />
            </Field>
          </Row>
        ) : null}
        {settingsFields}
        <Row label="Qo'shimcha" hint="Modelga alohida talab" wide>
          <Field id="extra">
            <LimitedTextarea
              ariaLabel="Qo'shimcha"
              value={ui.extra}
              onChange={(v) => set("extra", v)}
              limit={TEACHER_LIMITS.extraChars}
              rows={2}
              placeholder="Ixtiyoriy"
            />
          </Field>
        </Row>
        <div className="mt-2">
          <ClearFormButton armed={clearConfirm.armed} onClick={clearConfirm.trigger} />
        </div>
      </SettingsDetails>
      {fileBusy ? <p className="text-muted-foreground -mt-2 mb-4 text-[11px]">Fayl o‘qilmoqda…</p> : null}
    </ToolChrome>
  );
}
