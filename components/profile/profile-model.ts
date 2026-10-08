/**
 * The profile's pure model now lives in `lib/profile/fields.ts`, shared by the
 * web profile screens and the bot's «Profilim» (docs/bot/PLAN.md, B2). This
 * module stays so the existing imports keep working (named re-exports: a bare
 * `export *` is not seen through by the tsx test loader).
 */
export {
  EMPTY_HINT,
  FIELD_MAX,
  PROFILE_FIELDS,
  PROFILE_STEPS,
  SETTINGS_STEPS,
  STEP_FIELDS,
  STEP_META,
  formatPhone,
  identityLine,
  isFieldStep,
  isProfileStepId,
  nextStep,
  profileHref,
  profilePatch,
  rowHint,
  shortName,
  stepCompletion,
  stepIndex,
} from "@/lib/profile/fields";
export type {
  FieldSpec,
  FieldStepId,
  ProfileField,
  ProfileStepId,
  ProfileTarget,
  ProfileValues,
} from "@/lib/profile/fields";
