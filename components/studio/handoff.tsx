"use client";

import { useCallback, useRef, useState } from "react";
import type { ClientEntry } from "@/lib/studio-core";
import { speechTextParam, spokenMax } from "@/lib/media/studio-speech";
import { STUDIO_AUDIO_LISTING, STUDIO_SPEECH_PURPOSE, STUDIO_VIDEO_PURPOSE, inputFromResult, loadMediaCatalog, resultAssetOf } from "./studio-api";
import type { MediaCatalog } from "./studio-types";
import { PROMPT_PARAM, promptLimit } from "./studio-values";
import { offeredModes, type AudioTabState } from "./audio/AudioTab";
import { splitVideoCatalog, startImageModels, type VideoTabState } from "./video/VideoTab";
import { splitSpeechCatalog, type VoiceTabState } from "./voice/VoiceTab";

/**
 * Studio P7b chains — «Keyingi qadam» (docs/studio/P7-SPEC.md «P7b»). A chain is a HANDOFF, not a new engine: the next
 * tab opens prefilled and the user presses its own priced «Yaratish» (a normal job, the tab's own price; nothing is
 * charged by the handoff itself).
 *
 *   «Videoga aylantirish» (a finished picture) → «Video», «Matndan / rasmdan», the picture as the START FRAME. The
 *       picture travels exactly like the P2b tools: `POST /api/media/inputs/from-result` copies one picture of the user's
 *       OWN finished Studio job into their inputs (SQL ownership) and answers its asset id — no client URL is ever
 *       trusted; the submit checks the id is the user's own photo again. The picker then offers only the models that
 *       take a start image.
 *   «Musiqa yaratish» (a finished clip) → «Audio», «Musiqa», the clip's prompt as the description.
 *   «Ovoz qo'shish» (a picture / a clip) → «Ovoz», «Matn», the prompt as the text to read.
 *
 * Each handoff first reads the target tab's catalog (cached 30 s, the tab reads the same) and refuses with a message when
 * the tab has nothing to offer right now — so no input copy is made for a video that cannot be ordered.
 */

const IMAGE_PARAM = "imageAssetId";

/** The model of `models` to start on: the current choice when offered, else the catalog default when offered, else the first. */
function pick(models: readonly ClientEntry[], chosen: string | null, catalog: MediaCatalog): ClientEntry {
  return models.find((m) => m.id === chosen) ?? models.find((m) => m.id === catalog.defaultModelId) ?? models[0]!;
}

/**
 * The Video tab after «Videoga aylantirish»: text/image mode, a start-image model, a fresh form with the picture's prompt
 * (cut to the model's limit; editable) and the picture as the start frame; `fromPicture` keeps the picker on the
 * start-image models until the frame is removed. Pure.
 */
export function videoFromPicture(s: VideoTabState, assetId: string, prompt: string, models: readonly ClientEntry[], catalog: MediaCatalog): VideoTabState {
  const model = pick(models, s.chosen, catalog);
  return { ...s, mode: "text", chosen: model.id, fromPicture: true, raw: { [PROMPT_PARAM]: prompt.slice(0, promptLimit(model)), [IMAGE_PARAM]: assetId } };
}

/** The «Ovoz» tab after «Ovoz qo'shish»: «Matn» mode, a text model, the prompt as the spoken text (cut to its limit). Pure. */
export function voiceFromText(s: VoiceTabState, text: string, models: readonly ClientEntry[], catalog: MediaCatalog): VoiceTabState {
  const model = pick(models, s.chosen, catalog);
  const field = speechTextParam(model);
  return { ...s, mode: "text", chosen: model.id, raw: { ...s.raw, [field]: text.slice(0, spokenMax(model) || text.length) } };
}

/** The «Audio» tab after «Musiqa yaratish»: «Musiqa» mode with the prompt as the description (cut to its limit). Pure. */
export function musicFromPrompt(s: AudioTabState, prompt: string, music: ClientEntry): AudioTabState {
  return { ...s, mode: "music", raw: { ...s.raw, music: { ...(s.raw.music ?? {}), [PROMPT_PARAM]: prompt.slice(0, promptLimit(music)) } } };
}

type Setter<T> = (fn: (s: T) => T) => void;
export type HandoffKind = "video" | "voice" | "music";

/**
 * The page's handoff actions. `open(tab)` switches the page to the create view on that tab. `pending` names the
 * handoff in flight (one at a time: a second press while one runs is ignored); `error` is the last refusal in Uzbek.
 */
export function useHandoffs({
  open,
  setVideoState,
  setVoiceState,
  setAudioState,
}: {
  open: (tab: "video" | "ovoz" | "audio") => void;
  setVideoState: Setter<VideoTabState>;
  setVoiceState: Setter<VoiceTabState>;
  setAudioState: Setter<AudioTabState>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<HandoffKind | null>(null);
  const running = useRef(false);

  const run = useCallback(async (kind: HandoffKind, fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Keyingi qadam ochilmadi");
    } finally {
      running.current = false;
      setPending(null);
    }
  }, []);

  /** «Videoga aylantirish»: the picture (a stored result URL of the user's own job) → the Video tab's start frame. */
  const toVideo = useCallback(
    (url: string, prompt: string) =>
      run("video", async () => {
        const ref = resultAssetOf(url);
        if (!ref) throw new Error("Bu rasmni ochib bo‘lmadi — natija sahifasidan yuklab, Video bo‘limida surat sifatida qo‘shing.");
        const catalog = await loadMediaCatalog(STUDIO_VIDEO_PURPOSE);
        const models = startImageModels(splitVideoCatalog(catalog).models);
        if (models.length === 0) throw new Error("Rasmdan video yaratish hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.");
        const got = await inputFromResult(ref.generationId, ref.assetId);
        setVideoState((s) => videoFromPicture(s, got.assetId, prompt, models, catalog));
        open("video");
      }),
    [run, open, setVideoState],
  );

  /** «Ovoz qo'shish»: the prompt → the «Ovoz» tab's text. */
  const toVoice = useCallback(
    (text: string) =>
      run("voice", async () => {
        const catalog = await loadMediaCatalog(STUDIO_SPEECH_PURPOSE);
        const models = splitSpeechCatalog(catalog).text;
        if (models.length === 0) throw new Error("Ovoz yaratish hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.");
        setVoiceState((s) => voiceFromText(s, text, models, catalog));
        open("ovoz");
      }),
    [run, open, setVoiceState],
  );

  /** «Musiqa yaratish»: the clip's prompt → the «Audio» tab's music description. */
  const toMusic = useCallback(
    (prompt: string) =>
      run("music", async () => {
        const catalog = await loadMediaCatalog(STUDIO_AUDIO_LISTING);
        const music = offeredModes(catalog.models).find((m) => m.mode === "music");
        if (!music) throw new Error("Musiqa yaratish hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.");
        setAudioState((s) => musicFromPrompt(s, prompt, music.entry));
        open("audio");
      }),
    [run, open, setAudioState],
  );

  return { error, clearError: useCallback(() => setError(null), []), pending, toVideo, toVoice, toMusic };
}

/** The last handoff refusal, shown where the user pressed (gallery) or above the tab's form. */
export function HandoffAlert({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" data-handoff-error className="text-destructive mb-3 text-[14.5px] leading-snug">
      {error}
    </p>
  );
}
