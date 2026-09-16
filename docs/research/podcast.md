# R8 — AI ovozli podkast (`podcast`, Media, mavzu/matn/fayl → ssenariy → MP3)

AUDIT-20 §1 R8 shabloni bo'yicha. Har faktga URL berilgan; o'zbek tilidagi
nutq tezligi bo'yicha rasmiy manba **topilmadi** — ochiq qoldirilgan
(6-band). TTS provayder tanlovi `tts.md` (R7) ga tegishli.

## 1. Konvensiya/standart va UX naqshlari

| Naqsh | Tavsif | Manba |
|---|---|---|
| **NotebookLM Audio Overview** | Manbalarni ikki AI "boshlovchi" suhbatiga aylantiradi; uzunlik **oldindan belgilangan 3 daraja** (Shorter/Default/Longer) — aniq daqiqa kiritish maydoni YO'Q; standart 10–20 daqiqa | [support.google.com/notebooklm](https://support.google.com/notebooklm/answer/16212820?hl=en), [xda-developers.com](https://www.xda-developers.com/notebooklm-audio-overview-custom-length/) |
| Format variantlari | «Deep Dive» (2 boshlovchi, chuqur tahlil, standart), «Critique» (tanqidiy baholash), «Debate» (rasmiy bahs) — barchasi 2-ovozli dialog | [chromestory.com](https://chromestory.com/2026/07/make-audio-overview-notebooklm/) |
| Nutq tezligi + so'z byudjeti (ingliz konvensiyasi) | **120–160 so'z/daqiqa**; 5 daq≈650–750 so'z, 15 daq≈1 950 so'z, 20 daq≈2 500–3 000 so'z | [descript.com](https://www.descript.com/blog/article/podcast-script), [vowordcounter.com](https://www.vowordcounter.com/articles/podcast-script-word-count/) |
| Ssenariy tuzilishi (20 daq misol) | cold open/hook (100–150 so'z) → intro+brend (75–150 so'z) → 2–4 asosiy blok → outro+chaqiriq (75–125 so'z) | [podcastor.ai/blog](https://podcastor.ai/blog/how-to-write-a-podcast-script) |

## 2. Raqobatchilar parametrlari (sodda.ai `podcast`, `docs/research/slaydtop-c-oyinlar-media.md`)

| Parametr | sodda.ai | Biz olamizmi | Sabab |
|---|---|---|---|
| Rejim | mavzu / matn / fayl (3 tile) | ha | AUDIT-20 §4 «mavzu/matn/fayl asosida» talabiga mos |
| Til | 18 til | ha | mavjud til-selektor |
| Davomiylik | 1/2/3/4/5 daqiqa chips, tekis | ha | AUDIT-20 §4 «1–5 daq» talabiga mos |
| Ovoz/jins/tezlik tanlovi | **YO'Q** — hech qaysi rejimda | MVP'da yo'q, keyin (`tts.md`) | raqobatchi ham qo'shmagan — audio sifat ovoz tanlovisiz ham yetarli bo'lishi mumkin |
| Narx | 4000 tekis, rejim/davomiylikdan qat'i nazar | ha (PM qarori) | AUDIT-20 §1 band 6 |
| Fayl-rejim qo'shimcha manba havolasi | «Manba hujjat havolasini qo'ying» (ixtiyoriy URL) | keyin | boshqa vositalarda ham (maqola, tarjimon) manba havolasi naqshi bor — kengaytirish oson |

## 3. Bizga tavsiya — reyestr

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `mode` | select | topic \| text \| file | topic | ha | input, prompt |
| `topic` | text | — | — | `mode=topic` da ha | prompt |
| `sourceText` | textarea | — | — | `mode=text` da ha | prompt (`sourceBlock`) |
| `sourceFile` | file | PDF/DOCX/TXT/MD | — | `mode=file` da ha | `extract-text.ts` → prompt |
| `duration` | chips | 1/2/3/4/5 daq | 2 | ha | prompt (so'z byudjeti), narx yo'q (tekis) |
| `language` | select | mavjud til ro'yxati | uz | ha | prompt, TTS tili |
| `speakerCount` | select | 1 \| 2 | 2 | ha | prompt (dialog/monolog), `AcademicDoc.audio.script` |

**Ssenariy skeleti** (2 ovozli, «Deep Dive» naqshiga moslashtirilgan):
kirish (hook savol/qiziqarli fakt, 1 replika) → 3 blok (har biri mavzuning
bir qirrasi, 2 ovoz almashinuvi bilan) → yakun (xulosa + tinglovchiga
savol/chaqiriq). 1 ovozli rejimda («monolog») bloklar orasida xuddi shu
tuzilma, lekin replikalar yo'q.

**So'z byudjeti:** AUDIT-20 §1 R8 qatorida taxmin qilingan **150 so'z/daq**
(ingliz konvensiyasi 120–160 bilan mos, o'zbekcha manba yo'q) qabul
qilinadi: 1 daq≈150 … 5 daq≈750 so'z, `durationWords` qoidasida ±15%.

**Ovoz/ton ko'rsatmalari:** 2 ovozli rejimda bitta "yetakchi" (savol
beruvchi, mavzuni tanishtiradi) va bitta "ekspert" (tushuntiruvchi) roli
— NotebookLM Deep Dive naqshiga mos; ton — suhbatdosh, rasmiy emas
(`prompts.ts` uslubi bilan uyg'un).

**SSML pauzalar:** replikalar orasida qisqa pauza (`<break time="400ms"/>`
ekvivalenti, aniq mexanizm TTS tanloviga bog'liq, `tts.md`), bo'lim
(3 blok) orasida uzunroq pauza. **Fon musiqasi:** MVP'da **yo'q** — ochiq
litsenziyali manba tanlanmagan, huquqiy xavf past bo'lishi uchun
(tavsiya, 6-bandda tasdiqlash kerak).

**Ma'lumot modeli** (`AcademicDoc.audio`, AUDIT-20 §4 bilan mos):

```json
{
  "kind": "podcast",
  "audio": {
    "script": [
      { "speaker": "A", "text": "Bugun nega ba'zi o'simliklar tunda gullaydi?" },
      { "speaker": "B", "text": "Qiziq savol — bu haqda uchta asosiy sabab bor..." }
    ],
    "seconds": 118,
    "voice": "provider:voice-id"
  }
}
```

**Ko'rish oqimi (game emas — Media guruhi):** generatsiya → natija sahifasi
→ `AudioViewer` (`<audio>` pleer + transkript matn) → yuklab olish (MP3).
Ochiq `/o/[token]` o'yin havolasi bu vositaga tegishli emas (faqat
interaktiv o'yinlar uchun, AUDIT-20 §4).

## 4. Sifat mezonlari

**Deterministik qoidalar:**

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `durationWords` | Ssenariy so'z soni `duration × 150` ga mos | ±15% |
| `structure` | Kirish + 3 blok + yakun barchasi mavjud | 5/5 bo'lim |
| `speakerBalance` | 2 ovozli rejimda har ikkisi gapiradi | har birining ulushi 30–70% oralig'ida |
| `noFabricatedFacts` | Manbasiz aniq raqam/sana/statistika ishlatilmagan (`mode=topic`da ayniqsa) | 0 buzilish |
| `sourceGrounded` (`mode=text/file`) | Asosiy faktlar manba matnidan olingan, o'ylab topilmagan | judge tekshiradi |

**Judge mezonlari (ingliz, 3–5):**

1. `topicCoverage` — does the script meaningfully cover the topic across its 3 segments, not just restate the intro?
2. `conversationalFlow` — (2-speaker mode) do the turns feel like a natural exchange, not two monologues stitched together?
3. `factualCaution` — are specific numbers/statistics avoided or clearly hedged when no source was provided?
4. `speakability` — are sentences short and punctuated for natural TTS delivery (no run-ons, no unpronounceable abbreviations)?
5. `engagingHook` — does the opening line create curiosity rather than a generic "Bugun biz ... haqida gaplashamiz" filler?

**Halollik chegarasi:** `mode=topic`da model manbasiz aniq raqam/tadqiqot
natijasi/statistika keltirmaydi (masalan "tadqiqotlar 73% ni ko'rsatadi"
kabi soxta da'vo taqiqlanadi); `mode=text/file`da faktlar FAQAT berilgan
manbadan olinadi (`sourceBlock` qoidasi bilan bir xil mantiq).

## 5. Namunalar

- NotebookLM Audio Overview rasmiy sahifasi: [support.google.com/notebooklm](https://support.google.com/notebooklm/answer/16212820?hl=en)
- Ssenariy so'z/daqiqa hisobi: [vowordcounter.com](https://www.vowordcounter.com/articles/podcast-script-word-count/)

**LLM uchun yaxshi/yomon misol (2 daq, mavzu: "Uyqu va xotira"):**

- ✅ Yaxshi kirish: «Nega imtihondan oldin tunni uyqusiz o'tkazish yordam
  bermaydi? Bugun aynan shu haqda gaplashamiz.» — qiziqish uyg'otadi.
- ❌ Yomon kirish: «Assalomu alaykum, bugungi podkastimizda biz muhim
  bir mavzu haqida gaplashamiz.» — umumiy shablon (`engagingHook` buzilishi).

## 6. Ochiq savollar / egasidan kerak narsalar

1. O'zbek nutq tezligi (so'z/daqiqa) bo'yicha rasmiy manba topilmadi —
   ishchi qiymat 150 so'z/daq qabul qilinsinmi, yoki TTS sinovidan
   (`tts.md`) keyin haqiqiy o'lchov bilan kalibrlanadimi?
2. Standart `speakerCount` 2 yoki 1 — TTS provayder 2 xil ovozni
   qo'llab-quvvatlashiga bog'liq (`tts.md`). Fon musiqasi keyin
   qo'shiladimi (litsenziya kerak) — hozircha "yo'q", tasdiqmi?
3. `mode=file`da uzun hujjat maqola/tarjimondagi kabi bo'lak-bo'lak
   (`chunk`) prompt qilinadimi?
