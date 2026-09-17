/**
 * TTS QATLAMINING KIRISH NUQTASI (AUDIT-22 WP-A).
 *
 * Dvigatel (`audio/engine.ts`), zond va `scripts/tts-lab.mts` FAQAT shu
 * fayldan import qiladi — `report/index.ts` bilan ayni naqsh. Shunda
 * provayder qo'shilgan/olib tashlanganda chaqiruvchilarning importi
 * o'zgarmaydi.
 *
 *   types.ts   shartnoma, til → ovoz jadvali, `chunkText`, `TtsMeter`, narx
 *   mp3.ts     kadr tahlili, `concatMp3`, WAV→MP3 (`lamejs`, lazy)
 *   azure.ts   REST adapteri (MP3) — zanjirning birinchi bo'g'ini
 *   aisha.ts   REST adapteri (WAV) — mahalliy o'zbek provayderi
 *   gemini.ts  preview adapteri (PCM→WAV) — ataylab o'chirilgan standart
 *   chain.ts   til bo'yicha zanjir; provayder BUTUN ish uchun bog'lanadi
 */
export {
  TTS_FALLBACK_LANG,
  TTS_LANG_VOICES,
  TTS_LIMITS,
  TTS_PRICES,
  TTS_PROVIDERS,
  TtsError,
  TtsMeter,
  audioBytes,
  chunkText,
  formatVoiceId,
  isRetryableTtsError,
  isTtsProviderId,
  parseVoiceId,
  ttsCostUsd,
  ttsVerified,
  ttsVoiceFor,
  ttsVoicesFor,
} from "./types";
export type { TtsAudio, TtsCostJson, TtsPrice, TtsProvider, TtsProviderId, TtsSynthOpts, TtsUsage, TtsVoiceSpec } from "./types";

export {
  MP3_BITRATE_KBPS,
  concatMp3,
  hasId3v1,
  id3v2Length,
  isXingFrame,
  loadMp3Encoder,
  mergeToMp3,
  mp3Frames,
  mp3Profile,
  mp3Seconds,
  pcmToWav,
  readFrame,
  sameProfile,
  stripTags,
  wavInfo,
  wavSeconds,
  wavToMp3,
} from "./mp3";
export type { AudioPiece, Mp3EncoderFactory, Mp3EncoderLike, Mp3Frame, Mp3Profile, MpegVersion, WavInfo } from "./mp3";

export { AZURE_OUTPUT_FORMAT, azureEndpoint, azureKey, azureRegion, azureSsml, azureTts, localeOfVoice, makeAzureTts, prosodyRate, xmlEscape } from "./azure";
export { AISHA_MAX_CHARS, AISHA_URL, aishaAudioRef, aishaBody, aishaKey, aishaTts, makeAishaTts } from "./aisha";
export { GEMINI_TTS_BASE, geminiAudioPart, geminiKey, geminiTts, geminiTtsModel, makeGeminiTts, pcmRateOf } from "./gemini";

export { chainOfProvider, makeTtsChain, ttsChain, ttsGroups, ttsVoiceChain, ttsVoiceEnvName } from "./chain";
export type { TtsChain, TtsChainDeps, TtsPart, TtsProviderGroup, TtsRun } from "./chain";
