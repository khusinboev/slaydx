# R8 — Tinglash o'yini (`listening`, til o'rganish, TTS parchalar)

AUDIT-20 §1 R8 shabloni bo'yicha. Har faktga URL berilgan; manbasiz joyda
"aniqlanmadi" deb ochiq qoldirilgan. TTS provayder/ovoz tanlovi `tts.md`
(R7) hisobotiga tegishli — bu yerda faqat o'yin mexanikasi/parametrlari.

## 1. Konvensiya/standart va UX naqshlari

| Naqsh | Tavsif | Manba |
|---|---|---|
| **Listen & Select** (Duolingo English Test) | Audio eshitiladi → foydalanuvchi audio va yozma variantlar orasidan mos juftni tanlaydi (tugma bilan) | [detpractice.com/…interactive-listening](https://www.detpractice.com/question-types/interactive-listening) |
| **DuoRadio** (Duolingo) | Qisqa audio eshitiladi → so'z kartochkalari orasidan "eshitgan 3 so'zni tanla" | [blog.duolingo.com/duoradio-listening-practice](https://blog.duolingo.com/duoradio-listening-practice) |
| **Audio rejim** (Quizlet Learn/Match) | TTS matnni o'qib beradi ("Speak It"), foydalanuvchi qayta eshitish (`replay`) tugmasi bilan takrorlaydi; 300 belgidan uzun matn TTS'da o'qilmaydi (texnik chegara) | [quizlet.com/blog/learning-vocabulary-with-audio-support](https://quizlet.com/blog/learning-vocabulary-with-audio-support) |
| Distraktor sifati (SLA tadqiqoti) | Yaxshi distraktor **semantik yaqin, lekin noto'g'ri** bo'lishi kerak — tasodifiy/aloqasiz so'z distraktor sifatini pasaytiradi | [Distractor Plausibility in a Multiple-Choice Listening Test](https://www.researchgate.net/publication/334003786_Distractor_Plausibility_in_a_Multiple-Choice_Listening_Test) |
| O'yinchi oqimi | Havola/QR → ism → o'yin → natija (Kahoot/Blooket naqshi, saralash hisobotida ham qayd etilgan) | [Blooket join](https://www.makerstations.io/blooket-join/) |

## 2. Raqobatchilar parametrlari (sodda.ai `listening-game`, `docs/research/slaydtop-b-oyinlar-1.md`)

| Parametr | sodda.ai | Biz olamizmi | Sabab |
|---|---|---|---|
| Mavzu | erkin matn, majburiy | ha | asosiy kirish |
| **Ona til** VA **o'rganiladigan til** — 2 ta MUSTAQIL 18-til selektor | ha (nazariy 18×18 kombinatsiya) | ha | til o'rgatish vositasi uchun tabiiy naqsh — bizda glossary/keys'da bitta til bor, bu yerda ikkitasi kerak |
| So'z soni | 5/10/15/20 chips | ha | mavjud chips naqshi |
| Ovoz tanlovi | **yo'q** (server-side TTS, CSP `media-src …digitaloceanspaces.com` orqali aniqlandi, provayder ko'rinmadi) | keyin (`tts.md` qaroriga bog'liq) | MVP'da bitta standart ovoz yetarli |
| Narx | 2000 tekis, so'z sonidan qat'i nazar | ha | AUDIT-20 §1 band 6 |
| Chiqish formati | ko'rinmadi (interaktiv veb-o'yin taxmin qilinadi) | interaktiv + bosma (2 bosqich, AUDIT-20 §1 band 3) | bizning ikki-bosqichli qoida |

## 3. Bizga tavsiya — reyestr

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `topic` | text | — | — | ha | prompt |
| `nativeLanguage` | select | mavjud til ro'yxati | uz | ha | prompt (tarjima yo'nalishi) |
| `targetLanguage` | select | mavjud til ro'yxati (≠ `nativeLanguage`) | en | ha | prompt, TTS ovoz tili |
| `wordCount` | chips | 5/10/15/20 | 10 | ha | prompt, `delivered`, TTS xarajat (`cost_json`) |

**Ma'lumot modeli** (`AcademicDoc.game.listening`, AUDIT-20 §4 rejasi bilan mos):

```json
{
  "kind": "listening",
  "listening": {
    "pairs": [
      {
        "id": "w1",
        "word": "library",
        "translation": "kutubxona",
        "audioAssetId": "asset_abc",
        "distractors": ["muzey", "maktab", "dorixona"]
      }
    ]
  }
}
```

`distractors` — 3 ta, `targetLanguage`dagi so'zning **tarjimasi** bilan bir
semantik maydondan (masalan "joy" kategoriyasi), lekin noto'g'ri — yuqoridagi
SLA tadqiqot tavsiyasi bilan mos.

**O'yinchi oqimi (ekranlar):** 1) ochiq havola → 2) ism → 3) o'yin ekrani
(audio pleer + 4 variant matn tugmasi, `replay` tugmasi cheksiz, Quizlet
naqshi) → 4) keyingi so'z → 5) natija ekrani (ball, qaysi so'zlarda
xato) → 6) egasi tomonida natijalar jadvali.

**Ball/natija formulasi:** `score = to'g'ri tanlangan juftlar / jami so'zlar
× 100`; `replay` bosilishi ballga ta'sir qilmaydi (Quizlet naqshi — audio
qayta eshitish jazolanmaydi), lekin `answers_json`da soni saqlanadi.

**Bosma versiya:** so'zlar ro'yxati jadvali — `So'z (target) | Tarjima
(native) | Transkripsiya (ixtiyoriy)`; audio bosma versiyada bo'lmaydi,
shuning uchun bosma variant — lug'at/yodlash varag'i sifatida xizmat qiladi.

## 4. Sifat mezonlari

**Deterministik qoidalar:**

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `wordCount` | Juftlar soni parametrga teng | qat'iy = |
| `uniqueWords` | So'zlar takrorlanmaydi | 0 dublikat |
| `distractorCount` | Har so'zda aniq 3 distraktor | qat'iy = 3 |
| `distractorNotDuplicate` | Distraktorlar to'g'ri javobga yoki bir-biriga teng emas | 0 mos kelish |
| `audioDuration` | Har audio parcha uzunligi so'z uzunligiga mos (juda uzun/qisqa emas) | 0.5–3 s (taxminiy, TTS sinovidan keyin aniqlanadi) |

**Judge mezonlari (ingliz, 3–5):**

1. `translationAccuracy` — is the translation semantically correct and natural for the target/native language pair?
2. `distractorPlausibility` — are the three distractors from the same semantic category as the answer, plausible but clearly wrong on reflection?
3. `levelFit` — is the vocabulary difficulty consistent across the set (not mixing trivial and highly advanced words)?
4. `speakability` — is the target word/phrase short and clean enough for natural TTS pronunciation (no abbreviations, ambiguous homographs)?

**Halollik chegarasi:** tarjima LLM tomonidan o'ylab topilmasin — noaniq
yoki ko'p ma'noli so'zlar (masalan kontekstsiz tarjimasi noaniq atamalar)
promptda **rad etiladi**, model faqat keng tarqalgan, bir ma'noli
tarjimalarni tanlaydi.

## 5. Namunalar

- Duolingo Listen & Select tavsifi: [detpractice.com](https://www.detpractice.com/question-types/interactive-listening)
- DuoRadio (audio → so'z tanlash) tavsifi: [blog.duolingo.com](https://blog.duolingo.com/duoradio-listening-practice)

**LLM uchun yaxshi/yomon misol (mavzu: "Shahar joylari", en→uz):**

- ✅ Yaxshi: so'z "library" → to'g'ri "kutubxona"; distraktorlar "muzey",
  "maktab", "dorixona" — barchasi "shahar binosi" kategoriyasidan, lekin
  aniq farqli.
- ❌ Yomon: so'z "library" → distraktorlar "quyosh", "stul", "yugurish" —
  aloqasiz so'zlar, farqlash ahamiyatsiz darajada oson (`distractorPlausibility`
  qoidasi rad etadi).

## 6. Ochiq savollar / egasidan kerak narsalar

1. TTS ovoz/provayder tanlovi `tts.md` (R7) natijasiga bog'liq — egasi
   3 provayderni eshitib tanlagach shu hisobot yangilanadimi?
2. `nativeLanguage`/`targetLanguage` ikkalasi ham kerakmi, yoki interfeys
   tili (uz) avtomatik "native" deb olib, foydalanuvchi faqat
   `targetLanguage`ni tanlaydigan soddaroq forma yaxshiroqmi (raqobatchida
   ikkalasi bor, lekin bizning boshqa vositalarimiz bitta til maydoniga
   ko'nikkan)?
3. Distraktor semantik yaqinligini LLM promptida qanday kafolatlash —
   faqat ko'rsatma bilanmi, yoki `judge` orqali qayta yozdirishmi (`review.ts`
   naqshi)?
