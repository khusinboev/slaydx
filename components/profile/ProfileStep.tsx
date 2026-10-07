"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Moon, RotateCw, Send, Smartphone, Sun, SunMoon, type LucideIcon } from "lucide-react";
import * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/lib/store";
import { useHideInAppBack } from "@/components/telegram/useMiniAppShell";
import { ACCENT_INK, ACCENT_SOFT, Group, IconChip, PRIMARY_BUTTON, ProfileSkeleton, SignedOutCard, StepProgress } from "./parts";
import {
  FIELD_MAX,
  SETTINGS_STEPS,
  STEP_FIELDS,
  STEP_META,
  formatPhone,
  isFieldStep,
  nextStep,
  profileHref,
  profilePatch,
  stepIndex,
  type FieldSpec,
  type FieldStepId,
  type ProfileField,
  type ProfileStepId,
  type ProfileTarget,
} from "./profile-model";
import { THEME_CHOICES, useThemeChoice, type ThemeChoice } from "./theme";

export type ProfileStepProps = {
  step: ProfileStepId;
  /** «←», «Saqlash va keyingisi» and logout: the next step id or `"home"` (the index). */
  onNavigate: (to: ProfileTarget) => void;
};

/** Autosave delay after the last keystroke (as the old profile page). */
export const AUTOSAVE_MS = 800;

/**
 * One profile step page (redesign W4): back + title, the 4-segment progress
 * of the «Sozlamalar» flow, then the step body — writer fields with autosave
 * (`shaxsiy`, `oqish`, `ish`), the theme choice (`korinish`) or sessions and
 * logout (`xavfsizlik`).
 */
export function ProfileStep({ step, onNavigate }: ProfileStepProps) {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const hideBack = useHideInAppBack();
  const meta = STEP_META[step];
  const index = stepIndex(step);

  let body: ReactNode;
  if (!sessionChecked) body = <ProfileSkeleton />;
  else if (!loggedIn || !user) body = <SignedOutCard returnTo={profileHref(step)} />;
  else if (isFieldStep(step)) body = <FieldStep key={step} step={step} user={user} onNavigate={onNavigate} />;
  else if (step === "korinish") body = <ThemeStep onNavigate={onNavigate} />;
  else body = <SecurityStep user={user} onNavigate={onNavigate} />;

  return (
    <div data-profile-step={step} className="mx-auto w-full max-w-xl px-4 pt-3 pb-10">
      <div className="flex items-center gap-2.5 pt-1.5 pb-3">
        {hideBack ? null : (
          <button
            type="button"
            data-profile-back
            aria-label="Orqaga"
            onClick={() => onNavigate("home")}
            className="bg-card hover:bg-muted flex size-11 shrink-0 items-center justify-center rounded-[14px] border outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[21px] leading-tight font-semibold tracking-[-0.015em]">{meta.title}</h1>
          {index >= 0 ? (
            <p className="text-muted-foreground mt-0.5 text-[13px]">
              {index + 1}-qadam · {SETTINGS_STEPS.length} tadan
            </p>
          ) : null}
        </div>
      </div>
      {index >= 0 ? <StepProgress index={index} total={SETTINGS_STEPS.length} /> : null}
      <p className="text-muted-foreground mb-5 text-[15px] leading-relaxed">{meta.lead}</p>
      {body}
    </div>
  );
}

// ───────────────────────────────────────────── autosave

type Status = "idle" | "saving" | "saved" | "error";
type Draft = Partial<Record<ProfileField, string>>;

/**
 * Debounced PATCH of the edited fields (`api.updateProfile`). Saves run one
 * after another; what a save sent leaves the draft unless it was typed over
 * meanwhile. Leaving the page (unmount) or the field (blur) saves at once.
 */
export function useProfileAutosave(delay = AUTOSAVE_MS) {
  const setUser = useAppStore((s) => s.setUser);
  const [draft, setDraftState] = useState<Draft>({});
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<Draft>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const mounted = useRef(false);

  const setDraft = useCallback((next: Draft) => {
    draftRef.current = next;
    if (mounted.current) setDraftState(next);
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const run = chain.current.then(async () => {
      const sent = profilePatch(draftRef.current);
      if (!Object.keys(sent).length) return true;
      if (mounted.current) {
        setStatus("saving");
        setError(null);
      }
      try {
        const r = await api.updateProfile(sent);
        setUser(r.user);
        const rest: Draft = { ...draftRef.current };
        for (const k of Object.keys(sent) as ProfileField[]) if (rest[k] === sent[k]) delete rest[k];
        setDraft(rest);
        if (mounted.current) {
          setStatus("saved");
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
        }
        return true;
      } catch (e) {
        if (mounted.current) {
          setStatus("error");
          setError(e instanceof Error && e.message ? e.message : "Saqlanmadi");
        }
        return false;
      }
    });
    chain.current = run;
    return run;
  }, [setDraft, setUser]);

  const edit = useCallback(
    (key: ProfileField, value: string) => {
      setDraft({ ...draftRef.current, [key]: value.slice(0, FIELD_MAX) });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush, setDraft],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (savedTimer.current) clearTimeout(savedTimer.current);
      // Leaving with unsaved edits (back, tab switch): save now, not never.
      if (timer.current || Object.keys(draftRef.current).length) void flush();
    };
  }, [flush]);

  return { draft, status, error, edit, flush, dirty: Object.keys(draft).length > 0 };
}

function SaveStatus({ status, error, onRetry }: { status: Status; error: string | null; onRetry: () => void }) {
  if (status === "error") {
    return (
      <div role="alert" data-profile-save-error className="border-destructive/30 bg-destructive/5 mt-1 flex items-center gap-3 rounded-[14px] border px-3.5 py-2.5">
        <span className="text-destructive min-w-0 flex-1 text-[14px]">Saqlanmadi: {error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-destructive hover:bg-destructive/10 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <RotateCw aria-hidden className="size-4" />
          Qayta urinish
        </button>
      </div>
    );
  }
  return (
    <p data-profile-save-status aria-live="polite" className="text-muted-foreground flex min-h-6 items-center gap-1.5 text-[13.5px]">
      {status === "saving" ? "Saqlanmoqda…" : null}
      {status === "saved" ? (
        <>
          <Check aria-hidden className="text-success-text size-4" />
          Saqlandi
        </>
      ) : null}
    </p>
  );
}

// ───────────────────────────────────────────── field steps

function Field({ spec, value, onChange, onBlur }: { spec: FieldSpec; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const id = useId();
  return (
    <div className="mb-4">
      <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[13.5px] font-medium">
        {spec.label}
      </label>
      <input
        id={id}
        name={spec.key}
        data-profile-field={spec.key}
        value={value}
        maxLength={FIELD_MAX}
        placeholder={spec.placeholder}
        autoComplete={spec.autoComplete ?? "off"}
        inputMode={spec.inputMode}
        aria-describedby={spec.helper ? `${id}-help` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="border-input bg-card placeholder:text-muted-foreground/70 focus:border-primary focus:ring-primary/25 h-[50px] w-full rounded-[14px] border px-3.5 text-[16px] outline-none transition-[border-color,box-shadow] duration-150 focus:ring-[3px] motion-reduce:transition-none"
      />
      {spec.helper ? (
        <p id={`${id}-help`} className="text-muted-foreground mt-1.5 text-[13px] leading-snug">
          {spec.helper}
        </p>
      ) : null}
    </div>
  );
}

function FieldStep({ step, user, onNavigate }: { step: FieldStepId; user: api.ServerUser; onNavigate: (to: ProfileTarget) => void }) {
  const { draft, status, error, edit, flush } = useProfileAutosave();
  const [advancing, setAdvancing] = useState(false);
  const next = nextStep(step);

  const saveAndNext = async () => {
    setAdvancing(true);
    const ok = await flush();
    setAdvancing(false);
    if (ok) onNavigate(next);
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void saveAndNext();
      }}
    >
      {STEP_FIELDS[step].map((spec) => (
        <Field
          key={spec.key}
          spec={spec}
          value={draft[spec.key] ?? user[spec.key] ?? ""}
          onChange={(v) => edit(spec.key, v)}
          onBlur={() => void flush()}
        />
      ))}
      <SaveStatus status={status} error={error} onRetry={() => void flush()} />
      <button type="submit" data-profile-next disabled={advancing} className={cn(PRIMARY_BUTTON, "mt-3")}>
        {advancing ? "Saqlanmoqda…" : next === "home" ? "Saqlash va yakunlash" : "Saqlash va keyingisi"}
      </button>
      <p className="text-muted-foreground mt-3 text-center text-[13px]">O&apos;zgarishlar yozishingiz bilan saqlanadi.</p>
    </form>
  );
}

// ───────────────────────────────────────────── korinish

const THEME_ICONS: Record<ThemeChoice, LucideIcon> = { light: Sun, dark: Moon, auto: SunMoon };

function ThemeStep({ onNavigate }: { onNavigate: (to: ProfileTarget) => void }) {
  const [choice, setChoice] = useThemeChoice();
  const name = useId();
  return (
    <>
      <fieldset>
        <legend className="sr-only">Mavzu</legend>
        <ul className="bg-card divide-border divide-y overflow-hidden rounded-[20px] border">
          {THEME_CHOICES.map((c) => {
            const Icon = THEME_ICONS[c.value];
            const on = choice === c.value;
            return (
              <li key={c.value}>
                <label
                  data-theme-choice={c.value}
                  className={cn(
                    "flex min-h-[64px] cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-primary motion-reduce:transition-none",
                    on && ACCENT_SOFT,
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={c.value}
                    checked={on}
                    onChange={() => setChoice(c.value)}
                    className="sr-only"
                  />
                  <IconChip icon={Icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15.5px] font-medium">{c.label}</span>
                    <span className="text-muted-foreground block text-[13px]">{c.hint}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p className="text-muted-foreground mt-3 text-[13px] leading-snug">Tanlov shu qurilmada saqlanadi va darhol qo&apos;llanadi.</p>
      <button type="button" data-profile-next onClick={() => onNavigate(nextStep("korinish"))} className={cn(PRIMARY_BUTTON, "mt-5")}>
        Saqlash va yakunlash
      </button>
    </>
  );
}

// ───────────────────────────────────────────── xavfsizlik

function InfoRow({ icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <li className="flex min-h-[54px] items-center gap-3 px-3.5 py-2">
      <IconChip icon={icon} />
      <span className="min-w-0 flex-1 text-[15.5px] font-medium">{label}</span>
      <span className="text-muted-foreground max-w-[55%] truncate text-[14px]">{value}</span>
    </li>
  );
}

function ConfirmBox({ text, yes, onYes, onCancel }: { text: string; yes: string; onYes: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={text} className="border-destructive/30 bg-destructive/5 rounded-[16px] border p-3.5">
      <p className="text-[15px] font-medium">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onYes}
          className="bg-destructive min-h-11 rounded-[12px] px-4 text-[15px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
        >
          {yes}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-card hover:bg-muted min-h-11 rounded-[12px] border px-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Bekor qilish
        </button>
      </div>
    </div>
  );
}

const DANGER_OUTLINE =
  "text-destructive border-destructive/40 hover:bg-destructive/10 flex min-h-[50px] w-full items-center justify-center rounded-[14px] border px-4 text-[15.5px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-destructive";

function SecurityStep({ user, onNavigate }: { user: api.ServerUser; onNavigate: (to: ProfileTarget) => void }) {
  const signOut = useAppStore((s) => s.signOut);
  // Two taps (unchanged from the old page): the first shows the warning, the second signs out.
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const leave = (all: boolean) => {
    void signOut(all)
      .catch(() => {})
      .finally(() => onNavigate("home"));
  };
  const phone = formatPhone(user.phone);

  return (
    <>
      {user.telegramId || phone ? (
        <Group label="Kirish usullari">
          {user.telegramId ? <InfoRow icon={Send} label="Telegram" value={user.username ? `@${user.username}` : "ulangan"} /> : null}
          {phone ? <InfoRow icon={Smartphone} label="Telefon" value={phone} /> : null}
        </Group>
      ) : null}

      <div className={cn("mt-4 rounded-[16px] px-4 py-3 text-[14px] leading-relaxed", ACCENT_SOFT)}>
        <p className={cn("font-semibold", ACCENT_INK)}>Sessiyalar haqida</p>
        <p className="mt-1">
          Har bir brauzer yoki Telegram ilovasida kirilgan holat — alohida sessiya. «Bu qurilmadan chiqish» faqat shu
          yerdagisini yopadi. «Hamma joydan chiqish» barcha sessiyalarni bekor qiladi: telefon yoki kompyuter yo&apos;qolsa,
          shuni bosing.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {confirmOut ? (
          <ConfirmBox text="Rostdan ham chiqmoqchimisiz?" yes="Ha, chiqish" onYes={() => leave(false)} onCancel={() => setConfirmOut(false)} />
        ) : (
          <button type="button" data-profile-logout onClick={() => setConfirmOut(true)} className={DANGER_OUTLINE}>
            Bu qurilmadan chiqish
          </button>
        )}
        {confirmAll ? (
          <ConfirmBox
            text="Barcha qurilmalardan chiqasiz. Davom etamizmi?"
            yes="Ha, hammasidan chiqish"
            onYes={() => leave(true)}
            onCancel={() => setConfirmAll(false)}
          />
        ) : (
          <button
            type="button"
            data-profile-logout-all
            onClick={() => setConfirmAll(true)}
            title="Barcha qurilmalardagi sessiyalarni bekor qiladi"
            className="text-muted-foreground hover:text-destructive min-h-11 rounded-[12px] text-[15px] font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            Hamma joydan chiqish
          </button>
        )}
      </div>
    </>
  );
}
