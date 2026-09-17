/**
 * AUDIO TAYYORLIK HISOBOTI (AUDIT-22 WP-A) — `reviewAudio`.
 *
 * Ikki qatlam (`infographic/review.ts` bilan ayni naqsh, mantiq NEYTRAL
 * qatlamda `report/`):
 *   1. QOIDALAR — `registry.ts AUDIO_RULE_IDS` da QULFLANGAN bandlar
 *      (podkast 8, tabriknoma 7). Ro'yxat reyestrda, chunki hisobot
 *      paneli qaysi bandlar bo'lishini oldindan bilishi kerak, va
 *      chunki qoidani unutib qo'yish testda ko'rinadi;
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3.
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 % baholovchi).
 *
 * `greeting.md` §4 dagi `noCliche` qoidasi ALOHIDA band emas: u
 * baholovchining `originality` mezoni bilan o'lchanadi (reyestr
 * `GREETING_JUDGE_CRITERIA`). Sabab — klişe deterministik ro'yxat bilan
 * aniqlanmaydi: «baxtli bo'ling» ibora sifatida klişe, lekin aniq
 * tilak bilan birga kelganda normal. Qat'iy ro'yxat yaxshi matnni ham
 * qizartirardi.
 *
 * Kirish `AcademicDoc`, sof ssenariy emas: hisobot avto-sayqaldan KEYIN
 * ham chaqiriladi (`report/polish-core.ts runPolishWith` `review(doc,
 * guard)` shaklini talab qiladi).
 *
 * Izomorf: DOM/server/TTS importi yo'q.
 */
import type { AcademicDoc } from "../types";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck, ReviewGuardInput, UserNeed } from "../report/types";
import { check, rewrite, scoreReviewFor } from "../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import { ttsVerified } from "../tts/types";
import { AUDIO_LIMITS, scriptWords, type AudioKind, type AudioLine, type AudioModel } from "./types";
import { AUDIO_RULE_IDS, audioTypeOf, type GreetingJudgeCriterion, type PodcastJudgeCriterion } from "./registry";
import { judgeText } from "./prompts";
import { speakerShares, spokenText, wordRange } from "./script";

export type AudioJudgeCriterion = PodcastJudgeCriterion | GreetingJudgeCriterion;
export type AudioJudgeResult = JudgeResult<AudioJudgeCriterion>;

export type AudioReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar, tez rejim). */
  judge?: boolean;
  now?: Date;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  /**
   * Formada SO'RALGAN daqiqa. Hisobot ssenariydan qayta hisoblanadi,
   * lekin «nechta daqiqa so'ralgan» hujjatda YO'Q — uni chaqiruvchi
   * beradi (sayqal ham o'sha qiymatni uzatadi, aks holda `durationWords`
   * bandi sayqaldan keyin boshqacha baholanardi).
   */
  minutes?: number;
  /** Foydalanuvchi bergan matn — `noFakeStats` halollik solishtiruvi. */
  facts?: string;
  /**
   * Tabriknomada «Kimga?» qiymati (`addresseeNamed` bandi).
   *
   * Berilmasa hujjatdan tiklanadi (`recipientOf`) — sayqal va natija
   * sahifasidagi «Tuzatish» formani KO'RMAYDI, ya'ni band ikkala yo'lda
   * ham bir xil baholanishi kerak.
   */
  recipient?: string;
};

/** Sayqal va «Tuzatish» uchun yagona nishon: ssenariyning O'ZI. */
export const SCRIPT_TARGET = "script";

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

/* ══════════════════════════ halollik ══════════════════════════ */

/**
 * Matndagi raqamlar — halollik solishtiruvi uchun normallashgan
 * (`infographic/review.ts numbersIn` bilan ayni qoida).
 *
 * Audioda qo'shimcha nozik joy bor: raqamlar SO'Z bilan yozilishi
 * kerak (`noWrittenOnly`), ya'ni model «yetmish uch foiz» deb yozishi
 * mumkin. Shuning uchun bu qoida RAQAMLI shaklni topganda ishlaydi va
 * u ikki tomonlama foydali: soxta statistika odatda aynan raqam bilan
 * keladi («73%»), so'z bilan yozilgani esa taxminiy ifoda bo'ladi.
 */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").matchAll(/\d[\d   ]*(?:[.,]\d+)?/g)) {
    const n = m[0].replace(/[  \s]/g, "").replace(",", ".").replace(/\.0+$/, "");
    if (n) out.push(n.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/** Yil (1900–2099) — sana halollik tekshiruvidan CHIQARILADI (bayram yili). */
const isYear = (n: string): boolean => /^(19|20)\d{2}$/.test(n);

/* ══════════════════════════ deterministik qoidalar ══════════════════════════ */

/** Yozma-only belgilar: qavs, URL, qisqartma, formula, markdown. */
export const WRITTEN_ONLY: { id: string; re: RegExp; label: string }[] = [
  { id: "url", re: /https?:\/\/|www\.|\S+@\S+\.\w{2,}/i, label: "havola yoki e-pochta" },
  { id: "paren", re: /\([^)]{3,}\)/, label: "qavs ichidagi izoh" },
  { id: "markdown", re: /(\*\*|__|^\s*[-*•]\s|^#{1,6}\s|\|\s*-{3,})/m, label: "markdown belgisi" },
  { id: "formula", re: /[=<>±×÷]\s*\d|\d\s*[+*/^]\s*\d/, label: "formula" },
  { id: "stage", re: /\[[^\]]{2,}\]|\((?:pauza|pause|kulgi|laughs)\)/i, label: "sahna ko'rsatmasi" },
];

/**
 * Deterministik bandlar. Id lar `AUDIO_RULE_IDS` bilan AYNAN mos
 * (test buni qulflaydi) — panel va sayqal shu id larni biladi.
 */
export function audioChecks(model: AudioModel, opts: { minutes?: number; facts?: string; recipient?: string } = {}): ReviewCheck[] {
  const kind: AudioKind = model.kind;
  const spec = audioTypeOf(kind, model.type);
  const script = model.script ?? [];
  const out: ReviewCheck[] = [];
  const text = spokenText(script);
  const minutes = opts.minutes ?? spec.limits.minutesDefault;
  const budget = minutes * AUDIO_LIMITS.wordsPerMinute;

  /* ── 1. durationWords (ikkala kindda) ── */
  {
    const n = scriptWords(script);
    const { min, max } = wordRange(budget);
    const d = `${n} so‘z (${minutes} daq × ${AUDIO_LIMITS.wordsPerMinute} = ${budget}, ruxsat ${min}–${max})`;
    const off = n < min || n > max;
    out.push(
      off
        ? check(
            "durationWords",
            n < min * 0.7 || n > max * 1.3 ? "red" : "yellow",
            "Davomiylik",
            `${d} — ${n < min ? "qisqa" : "uzun"}`,
            rewrite(SCRIPT_TARGET, `Rewrite the script to land between ${min} and ${max} words in total (it is now ${n}); ${n < min ? "add substance to the middle blocks, not new framing" : "cut wording, not information"}.`),
          )
        : check("durationWords", "green", "Davomiylik", d),
    );
  }

  /* ── 2. lineLength (ikkala kindda) ── */
  {
    const longLines = script.map((l, i) => ({ i, n: l.text.length })).filter((x) => x.n > AUDIO_LIMITS.lineCharsMax);
    const shortLines = script.filter((l) => l.text.trim().length < AUDIO_LIMITS.lineCharsMin).length;
    out.push(
      longLines.length
        ? check(
            "lineLength",
            "red",
            "Replika uzunligi",
            `${AUDIO_LIMITS.lineCharsMax} belgidan uzun: ${list(longLines.map((x) => `#${x.i + 1} (${x.n})`))}`,
            rewrite(SCRIPT_TARGET, `Split every line longer than ${AUDIO_LIMITS.lineCharsMax} characters into shorter turns; a single turn must be sayable without a written pause.`),
          )
        : script.length < AUDIO_LIMITS.linesMin
          ? check("lineLength", "yellow", "Replika uzunligi", `${script.length} replika — kamida ${AUDIO_LIMITS.linesMin} bo‘lishi kerak`)
          : check("lineLength", "green", "Replika uzunligi", `${script.length} replika, hammasi ≤${AUDIO_LIMITS.lineCharsMax} belgi${shortLines ? ` (${shortLines} ta juda qisqa)` : ""}`),
    );
  }

  /* ── 3. noWrittenOnly (ikkala kindda) ── */
  {
    const hits = WRITTEN_ONLY.filter((w) => w.re.test(text)).map((w) => w.label);
    out.push(
      hits.length
        ? check(
            "noWrittenOnly",
            "yellow",
            "Ovozga yaroqlilik",
            `matnda faqat yozuvda ishlaydigan element bor: ${list(hits)}`,
            rewrite(SCRIPT_TARGET, `Remove everything that only works in writing (${hits.join(", ")}): say it in words instead, the way a person says it aloud.`),
          )
        : check("noWrittenOnly", "green", "Ovozga yaroqlilik", "qavs, havola, formula va markdown yo‘q"),
    );
  }

  /* ── 4. closingPresent (ikkala kindda) ── */
  {
    const last = script[script.length - 1]?.text?.trim() ?? "";
    /*
     * Yakun BOR deb hisoblanadi, agar oxirgi replika tugallangan gap
     * bo'lsa. Nega shu o'lchov: eng ko'p uchraydigan nuqson — model
     * byudjetga urilib, gap O'RTASIDA to'xtashi (`closing` baholovchi
     * mezoni ham shuni tekshiradi, lekin u LLM ga tayanadi).
     */
    const finished = /[.!?…]$/.test(last);
    out.push(
      !last
        ? check("closingPresent", "red", "Yakun", "ssenariy bo‘sh tugadi", rewrite(SCRIPT_TARGET, "Add a closing turn that ends the piece."))
        : !finished
          ? check("closingPresent", "red", "Yakun", `oxirgi replika tugallanmagan: «…${last.slice(-60)}»`, rewrite(SCRIPT_TARGET, "The last line stops mid-thought — finish it with a complete closing sentence."))
          : check("closingPresent", "green", "Yakun", `oxirgi replika tugallangan (${last.length} belgi)`),
    );
  }

  if (kind === "podcast") {
    /* ── 5. blockCount ── */
    {
      const want = spec.kind === "podcast" ? spec.limits.blocks : 3;
      /*
       * BLOK — bu ROL ALMASHINUVI emas, MAZMUN birligi va u ssenariyda
       * alohida belgilanmaydi. Shuning uchun blok soni ROL
       * ALMASHINUVLARI orqali baholanadi: kirish + N blok + yakun
       * uchun kamida `2 × (want + 1)` replika kerak (har blokda savol
       * va javob).
       */
      const need = 2 * (want + 1);
      out.push(
        script.length < need
          ? check(
              "blockCount",
              script.length < need - 2 ? "red" : "yellow",
              "Bloklar",
              `${script.length} replika — ${want} blok + kirish + yakun uchun kamida ${need} kerak`,
              rewrite(SCRIPT_TARGET, `The episode must cover ${want} separate facets of the topic between the hook and the closing; expand it to at least ${need} turns without padding.`),
            )
          : check("blockCount", "green", "Bloklar", `${script.length} replika — ${want} blok, kirish va yakun uchun yetarli`),
      );
    }

    /* ── 6. speakerBalance ── */
    {
      const shares = speakerShares(script);
      const roles = Object.keys(shares);
      const wantTwo = spec.kind === "podcast" && spec.speakers >= 2;
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      if (!wantTwo) {
        out.push(check("speakerBalance", "green", "Ovozlar muvozanati", "monolog — muvozanat tekshirilmaydi"));
      } else if (roles.length < 2) {
        out.push(
          check("speakerBalance", "red", "Ovozlar muvozanati", "ikkinchi ovoz umuman gapirmaydi", rewrite(SCRIPT_TARGET, "This format needs two voices: give «B» real turns with substance, not one-word acknowledgements.")),
        );
      } else {
        const min = Math.min(...roles.map((r) => shares[r]));
        const detail = roles.map((r) => `${r} ${pct(shares[r])}`).join(", ");
        out.push(
          min < 0.3
            ? check("speakerBalance", "yellow", "Ovozlar muvozanati", `${detail} — biri 30 % dan kam gapiradi`, rewrite(SCRIPT_TARGET, "Rebalance the dialogue so each voice carries at least a third of the words; the quiet voice needs substance, not filler."))
            : check("speakerBalance", "green", "Ovozlar muvozanati", detail),
        );
      }
    }

    /* ── 7. hookPresent ── */
    {
      const first = script[0]?.text?.trim() ?? "";
      /*
       * Zaif kirish — `podcast.md` §5 dagi «yomon misol» naqshi:
       * «Bugun biz … haqida gaplashamiz». Ro'yxat TOR va aniq: keng
       * ro'yxat yaxshi kirishni ham qizartirardi, shuning uchun sifat
       * bahosi `hook` baholovchi mezoniga qoldiriladi.
       */
      const weak = /\b(bugun\s+biz|bugungi\s+(podkast|suhbat)|mavzu\s+haqida\s+gaplashamiz|сегодня\s+мы|today\s+we\s+will\s+talk)\b/i.test(first);
      const question = /[?]/.test(first);
      out.push(
        !first
          ? check("hookPresent", "red", "Kirish", "kirish replikasi yo‘q", rewrite(SCRIPT_TARGET, "Open with a concrete question, number or everyday situation."))
          : weak
            ? check("hookPresent", "yellow", "Kirish", `shablon ochilish: «${first.slice(0, 60)}…»`, rewrite(SCRIPT_TARGET, "Replace the opening line: start with a concrete question, a number or a situation the listener recognises — never with «bugun biz … haqida gaplashamiz»."))
            : check("hookPresent", "green", "Kirish", question ? "savol bilan boshlanadi" : `«${first.slice(0, 60)}…»`),
      );
    }

    /* ── 8. noFakeStats ── */
    {
      const facts = String(opts.facts ?? "");
      const have = new Set(numbersIn(facts));
      const invented = [...new Set(numbersIn(text))].filter((n) => !have.has(n) && !isYear(n));
      out.push(
        invented.length
          ? check(
              "noFakeStats",
              "red",
              "Raqamlar halolligi",
              `manbada yo‘q raqamlar: ${list(invented)}`,
              rewrite(SCRIPT_TARGET, `Remove every figure the user did not supply (${invented.join(", ")}). Say what it depends on, or describe the direction in words. Do not replace one invented number with another.`),
            )
          : check("noFakeStats", "green", "Raqamlar halolligi", facts.trim() ? "raqamlar foydalanuvchi ma’lumotidan" : "o‘ylab topilgan raqam yo‘q"),
      );
    }
  } else {
    /* ── 5. addresseeNamed ── */
    {
      const recipient = String(opts.recipient ?? "").trim();
      /*
       * Ism BIRINCHI SO'ZI bo'yicha izlanadi: «Dilnoza opa» deb
       * yozilgan bo'lsa, matnda «Hurmatli Dilnozaxon» yoki «Dilnoza
       * opamiz» bo'lishi mumkin — to'liq satrni izlash yaxshi tabrikni
       * ham qizartirardi.
       */
      const stem = recipient.split(/\s+/)[0]?.toLowerCase() ?? "";
      const low = text.toLowerCase();
      const hit = stem ? low.includes(stem) : false;
      const inFirst = stem ? (script[0]?.text ?? "").toLowerCase().includes(stem) : false;
      out.push(
        !recipient
          ? check("addresseeNamed", "yellow", "Murojaat", "«Kimga?» to‘ldirilmagan — tabrik umumiy chiqadi")
          : !hit
            ? check("addresseeNamed", "red", "Murojaat", `«${recipient}» matnda umuman uchramadi`, rewrite(SCRIPT_TARGET, `Address the person by name («${recipient}») in the first sentence and keep the greeting personal.`))
            : !inFirst
              ? check("addresseeNamed", "yellow", "Murojaat", `«${recipient}» bor, lekin birinchi jumlada emas`, rewrite(SCRIPT_TARGET, `Move the addressee's name («${recipient}») into the opening sentence — that is where a spoken greeting names the person.`))
              : check("addresseeNamed", "green", "Murojaat", `«${recipient}» birinchi jumlada`),
      );
    }

    /* ── 6. occasionMatch ── */
    {
      const occasion = spec.kind === "greeting" ? spec.occasion.trim() : "";
      if (!occasion) {
        out.push(check("occasionMatch", "green", "Sababga mosligi", "umumiy tabrik — sabab foydalanuvchi so‘zlari bilan"));
      } else {
        /*
         * Janr iborasining eng UZUN ma'noli so'zi bo'yicha tekshiriladi:
         * «Ustozlar va murabbiylar kuni» iborasi matnda AYNAN
         * takrorlanmasligi mumkin va shart ham emas, lekin «ustoz»
         * o'zagi bo'lishi kerak. Butun ibora izlansa qoida deyarli
         * hamisha qizil bo'lardi.
         */
        const stem = occasion
          .split(/\s+/)
          .filter((w) => w.length >= 5)
          .sort((a, b) => b.length - a.length)[0];
        const key = (stem ?? occasion).slice(0, 5).toLowerCase();
        out.push(
          text.toLowerCase().includes(key)
            ? check("occasionMatch", "green", "Sababga mosligi", `«${occasion}» janriga ishora bor`)
            : check("occasionMatch", "yellow", "Sababga mosligi", `«${occasion}» janriga hech qanday ishora topilmadi`, rewrite(SCRIPT_TARGET, `Name the occasion («${occasion}») explicitly and let the wishes belong to it — a text that would fit any holiday has failed this genre.`)),
        );
      }
    }

    /* ── 7. respectForm ── */
    {
      /*
       * Hurmat shakli — `greeting.md` §3: standart «siz». «Sen» shakli
       * FAQAT foydalanuvchi so'raganda; aks holda fayl xonada ovoz
       * chiqarib qo'yilganda hurmatsizlik bo'lib eshitiladi.
       *
       * Faqat O'ZBEK tilida tekshiriladi: boshqa tillarda «siz/sen»
       * farqi boshqacha ifodalanadi va yolg'on qizil band berardi.
       */
        const uz = String(model.language ?? "uz").toLowerCase().startsWith("uz");
      const informal = /\b(sen|sening|senga|seni|sensiz)\b/i.test(text);
      const asked = /\bsen\b/i.test(String(opts.facts ?? ""));
      out.push(
        !uz
          ? check("respectForm", "green", "Hurmat shakli", "bu tilda tekshirilmaydi")
          : informal && !asked
            ? check("respectForm", "yellow", "Hurmat shakli", "«sen» shakli ishlatilgan, foydalanuvchi so‘ramagan", rewrite(SCRIPT_TARGET, "Switch the whole greeting to the respectful «Siz» form — the user did not ask for the informal one."))
            : check("respectForm", "green", "Hurmat shakli", informal ? "«sen» — foydalanuvchi so‘raganidek" : "hurmatli «Siz» shakli"),
      );
    }
  }

  return out;
}

/**
 * «Kimga?» ni HUJJATDAN tiklaydi.
 *
 * Tabriknomada `doc.meta.topic` — `audioTitleOf` yozgan sarlavha
 * («Dilnoza opa — Ustozlar va murabbiylar kuni»), ya'ni adresat uning
 * BIRINCHI bo'lagi. Nega alohida maydon emas: `AudioModel` shartnomasi
 * R0 da qulflangan va unda `recipient` yo'q; sarlavha esa YAGONA manba
 * bo'lib, fayl nomi ham, hujjat sarlavhasi ham shundan chiqadi.
 */
export function recipientOf(doc: AcademicDoc): string {
  if (doc.audio?.kind !== "greeting") return "";
  return String(doc.meta.topic ?? "").split("—")[0].trim();
}

/* ══════════════════════════ «Sizdan kutiladi» ══════════════════════════ */

/**
 * AI O'YLAB TOPMAYDIGAN narsalar (AUDIT-18 Q-2).
 *
 * Audioda ular uchta: podkastda MANBA (raqam/statistika kerak bo'lsa),
 * tabriknomada ADRESAT va SHAXSIY tafsilot. To'rtinchisi — TIL: ovoz
 * TASDIQLANMAGAN bo'lsa (`kaa`/`ky`/`tg`/`tk`) foydalanuvchi buni
 * BILISHI kerak, aks holda u qirg'izcha matnni qozoqcha talaffuzda
 * eshitib, sababini tushunmasdi (`tts/types.ts` `verified` izohi).
 */
export function audioUserNeeds(review: DocReview, doc: AcademicDoc): UserNeed[] {
  const model = doc.audio;
  if (!model) return [];
  const out: UserNeed[] = [];

  if (!ttsVerified(model.language)) {
    out.push({
      id: "voice",
      label: "Ovoz tili",
      hint: "Bu til uchun rasmiy ovoz topilmadi — matn eng yaqin tilning ovozida o‘qiladi va talaffuz to‘liq mos kelmasligi mumkin",
    });
  }

  if (model.kind === "podcast") {
    const fake = review.checks.find((c) => c.id === "noFakeStats");
    if (fake && fake.level !== "green") {
      out.push({ id: "facts", label: "Raqam va manba", hint: `${fake.detail ?? ""} — statistika kerak bo‘lsa uni «Qo‘shimcha ma’lumot» maydoniga yozing yoki manba matn/fayl bering` });
    }
  } else {
    const who = review.checks.find((c) => c.id === "addresseeNamed");
    if (who && who.level !== "green") {
      out.push({ id: "recipient", label: "Kimga?", hint: "Tabrik ismsiz umumiy chiqadi — «Kimga?» maydonini to‘ldiring" });
    }
    out.push({
      id: "personal",
      label: "Shaxsiy tafsilot",
      hint: "Yosh, sana, ish joyi va birgalikdagi xotira AI tomonidan O‘YLAB TOPILMAYDI — ularni «Qo‘shimcha ma’lumot» maydoniga o‘zingiz yozing",
    });
  }
  return out;
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

export const targetsOf = (): string[] => [SCRIPT_TARGET];

/**
 * Turning `JudgeSpec` i — IKKI oilaning mezonlari BIRLASHMASI sifatida.
 *
 * Podkastning spetsifikatsiyasida `addressee` yo'q, tabriknomanikida
 * `hook` yo'q; neytral qatlam (`report/judge.ts`) esa BITTA `C` bilan
 * parametrlangan. Cast shu yerda, BIR JOYDA: `judgeChecksFor` va
 * `parseJudgeFor` faqat `spec.criteria` dagi mezonlarni yuradi, ya'ni
 * yo'q kalitga hech qachon murojaat qilinmaydi.
 */
function judgeSpecOf(model: AudioModel): JudgeSpec<AudioJudgeCriterion> {
  return audioTypeOf(model.kind, model.type).judge as unknown as JudgeSpec<AudioJudgeCriterion>;
}

export function neutralAudioJudge(model: AudioModel): AudioJudgeResult {
  return neutralJudgeFor(judgeSpecOf(model));
}

export function audioJudgeChecks(model: AudioModel, j: AudioJudgeResult): ReviewCheck[] {
  return judgeChecksFor(judgeSpecOf(model), j);
}

export function scoreAudioReview(rules: ReviewCheck[], model: AudioModel, j: AudioJudgeResult): number {
  return scoreReviewFor(rules, j, judgeSpecOf(model).criteria);
}

async function runJudge(model: AudioModel, facts: string, opts: AudioReviewOpts): Promise<{ judge: AudioJudgeResult; answered: boolean }> {
  const spec = judgeSpecOf(model);
  if (opts.judge === false || !opts.complete) return { judge: neutralJudgeFor(spec), answered: true };
  if (remainingMs(opts.deadline) < JUDGE_MIN_MS) return { judge: neutralJudgeFor(spec), answered: false };
  const targets = targetsOf();
  const system = judgeSystemPromptFor(spec, targets);
  const user = [
    judgeText(model.script ?? []),
    "",
    facts.trim() ? `USER DATA (the only admissible source of figures, dates and personal details):\n${facts.slice(0, 4000)}` : "USER DATA: none",
  ].join("\n");
  const r = await opts
    .complete("judge", system, user, { json: true, maxTokens: 1200, timeoutMs: Math.min(JUDGE_TIMEOUT_MS, Math.max(1, remainingMs(opts.deadline))) })
    .catch(() => null);
  if (r?.usage) opts.onUsage?.(r.usage);
  const parsed = parseJudgeFor(spec, r?.text, targets);
  return parsed ? { judge: parsed, answered: true } : { judge: neutralJudgeFor(spec), answered: false };
}

/* ══════════════════════════ kirish nuqtasi ══════════════════════════ */

export async function reviewAudio(doc: AcademicDoc, opts: AudioReviewOpts = {}): Promise<DocReview> {
  const model = doc.audio;
  const now = opts.now ?? new Date();
  if (!model || !model.script?.length) {
    return {
      score: 0,
      checks: [check("durationWords", "red", "Davomiylik", "ssenariy yo‘q")],
      judgeNotes: [],
      verifiedShare: 0,
      recentShare: 0,
      builtAt: now.toISOString(),
    };
  }

  const facts = opts.facts ?? String(doc.meta.extra ?? "");
  const recipient = opts.recipient ?? recipientOf(doc);
  const rules = audioChecks(model, { ...(opts.minutes !== undefined ? { minutes: opts.minutes } : {}), facts, recipient });
  const { judge, answered } = await runJudge(model, facts, opts);
  const review: DocReview = {
    score: scoreAudioReview(rules, model, judge),
    checks: [...rules, ...audioJudgeChecks(model, judge)],
    judgeNotes: answered ? judge.notes : [...judge.notes, JUDGE_NO_ANSWER],
    /*
     * `verifiedShare`/`recentShare` — MAQOLA o'lchovlari (tekshirilgan
     * va yangi manbalar ulushi). Podkastda adabiyotlar ro'yxati yo'q,
     * shuning uchun 0 (`infographic/review.ts` bilan ayni sabab).
     */
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
  review.userNeeds = audioUserNeeds(review, doc);
  return review;
}

/** Qoida id lari — reyestr bilan mosligini test qulflaydi. */
export function audioRuleIds(kind: AudioKind): readonly string[] {
  return AUDIO_RULE_IDS[kind];
}

/** Ssenariydan model yasash (test/zond uchun qulay qisqartma). */
export function modelOf(kind: AudioKind, type: string, language: string, script: AudioLine[]): AudioModel {
  return { v: 1, kind, type, language, script };
}
