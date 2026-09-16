# R8 — Ovozli tabriknoma (`greeting`, Media, kimga/sabab → ssenariy → MP3)

AUDIT-20 §1 R8 shabloni bo'yicha. Har faktga URL berilgan. TTS provayder
tanlovi `tts.md` (R7) ga tegishli, bu yerda faqat matn/ssenariy tomoni.

## 1. Konvensiya/standart va UX naqshlari

| Naqsh | Tavsif | Manba |
|---|---|---|
| O'zbek tabrik matni tuzilishi | murojaat (ism + hurmat shakli) → asosiy tabrik jumlasi (bayram/sabab nomi bilan) → tilaklar (sog'lik, baxt, muvaffaqiyat) → yakuniy iliq so'z; deyarli har namunada "Siz" (hurmat) shakli ishlatiladi | [qwert.uz — otaga](https://qwert.uz/2020/04/29/tugilgan-kun-uchun-tabriklar-matni-otaga-2/) |
| Janr: tug'ilgan kun | Sog'lik/baxt/oilaviy tinchlik tilaklari, adresatga qarab (ota/aka/do'st/qiz) alohida ton | [qwert.uz — akaga](https://qwert.uz/2020/04/29/tugilgan-kun-uchun-tabriklar-matni-akaga/), [qwert.uz — farzandga](https://qwert.uz/2020/05/06/tugilgan-kun-uchun-tabriklar-matni-farzandga-qizga/) |
| Janr: 8-mart | Ayollarga xos iboralar (nafosat, sabr, mehr), kelajakka tilaklar, oilaviy baxt | [baxtiyor.uz](https://baxtiyor.uz/8-mart-tabrik-ayollar-uchun-tabrik-va-tilaklar/) |
| Umumiy topilma | Ochiq qidiruvda **rasmiy/standartlashtirilgan** tabrik janr tasnifi (davlat hujjati) topilmadi — bu **de-fakto konvensiya** (ko'plab nashr qilingan namunalardan), rasmiy shakl emas | manbasiz da'vo yo'q — shuning uchun ochiq qoldirilgan |
| Adresatlar orqali murojaat shakli | Munosabatga qarab murojaat o'zgaradi: ota → "hurmatli otajon"/"aziz otam"; do'st → "aziz do'stim"; kattaroq odam → "hurmatli/opa/aka" | [qwert.uz — akaga](https://qwert.uz/2020/04/29/tugilgan-kun-uchun-tabriklar-matni-akaga/) |

## 2. Raqobatchilar parametrlari (sodda.ai `congratulation`, `docs/research/slaydtop-c-oyinlar-media.md`)

| Parametr | sodda.ai | Biz olamizmi | Sabab |
|---|---|---|---|
| Kimga tabrik | text, **yagona majburiy maydon** | ha | shaxsiylashtirish uchun zarur |
| Sizga kim bo'ladi | text, ixtiyoriy (masalan "opa, ustoz, do'st") | ha | ton/murojaat shaklini belgilaydi |
| Sabab yoki bayram | text, ixtiyoriy | ha | janr (tug'ilgan kun/8-mart/...) aniqlaydi |
| Til | 18 til | ha | mavjud til-selektor |
| Davomiylik | 1/2/3/4 daqiqa chips | ha | AUDIT-20 §4 «1–4 daq» talabiga mos |
| Ovoz/jins tanlovi | **YO'Q** | MVP'da yo'q (`tts.md`ga bog'liq) | raqobatchi ham qo'shmagan |
| Narx | 4000 tekis, davomiylikdan qat'i nazar | ha (PM qarori) | AUDIT-20 §1 band 6 |

## 3. Bizga tavsiya — reyestr

**Parametrlar:**

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `addressee` | text | — | — | ha | prompt (murojaat) |
| `relationship` | text | — | — | yo'q | prompt (ton, hurmat shakli) |
| `occasion` | text | — | — | yo'q | prompt (janr iboralar) |
| `duration` | chips | 1/2/3/4 daq | 1 | ha | prompt (so'z byudjeti) |
| `language` | select | mavjud til ro'yxati | uz | ha | prompt, TTS tili |

**Ssenariy skeleti:** murojaat+ochilish jumla (adresat ismi + hurmat
shakli bilan) → asosiy tabrik (sabab/bayram bilan bog'liq, agar
`occasion` berilgan bo'lsa aniq janr iboralar) → shaxsiy tilaklar
(`relationship`ga mos iliqlik darajasi) → yakuniy duo/tilak.

**So'z byudjeti:** podkast bilan bir xil ishchi qiymat 150 so'z/daq
(`podcast.md` 6-bandidagi ochiq savolga bog'liq) — 1 daq≈150 … 4 daq≈600.

**Ovoz/ton:** bitta ovoz (monolog — tabriknoma odatda bitta "tabriklovchi"
nomidan aytiladi); ton `relationship`ga qarab moslashadi ("ustoz" →
rasmiyroq; "do'st" → samimiy, lekin "siz" shakli standart qoladi, agar
foydalanuvchi aniq "sen" so'ramasa).

**SSML pauzalar:** murojaatdan keyin qisqa pauza, tilaklar orasida vergul
darajasidagi tabiiy pauza — aniq mexanizm TTS tanloviga bog'liq (`tts.md`).
**Fon musiqasi:** MVP'da **yo'q** (podkast bilan bir xil sabab — litsenziya
qarori kutilmoqda).

**Ma'lumot modeli** (`AcademicDoc.audio` qayta ishlatiladi, podkast bilan
bir xil shakl, faqat `kind:"greeting"` va odatda bitta `speaker`):

```json
{
  "kind": "greeting",
  "audio": {
    "script": [
      { "speaker": "A", "text": "Aziz Dilnoza opa, Sizni Ustozlar kuni bilan chin qalbdan tabriklayman..." }
    ],
    "seconds": 42,
    "voice": "provider:voice-id"
  }
}
```

**Ko'rish oqimi:** podkast bilan bir xil — Media guruhi, `AudioViewer`
(pleer + transkript), ochiq `/o/[token]` o'yin havolasiga TEGISHLI EMAS.

## 4. Sifat mezonlari

**Deterministik qoidalar:**

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `addressee` | Adresat ismi matnda kamida 1 marta ishlatilgan | ≥1 |
| `occasionMatch` | Agar `occasion` berilgan bo'lsa, mos an'anaviy ibora/janr elementi bor | judge tekshiradi |
| `length` | Ssenariy so'z soni `duration × 150` ga mos | ±15% |
| `noCliche` | Matn faqat "Tabriklayman! Baxtli bo'ling." darajasidagi generik jumla bilan cheklanmagan | ≥3 aniq/shaxsiy jumla |

**Judge mezonlari (ingliz, 3–5):**

1. `personalTouch` — does the text use the addressee's name and any given relationship/occasion details meaningfully, not just once at the top?
2. `occasionAuthenticity` — if an occasion was given, are the wishes and phrasing genuinely fitting for that occasion (not generic for any event)?
3. `respectForm` — is the address form (hurmat/"siz") consistent with the stated relationship, avoiding overly casual language for a formal relation (e.g. teacher, elder)?
4. `warmthTone` — does the tone feel warm and sincere rather than templated/corporate?

**Halollik chegarasi:** aniq shaxsiy voqea/xotira/yosh/sana **o'ylab
topilmasin** — faqat foydalanuvchi bergan `addressee`/`relationship`/
`occasion` asosida umumiy, lekin mos tabrik yoziladi; soxta shaxsiy
tafsilot ("sizning o'sha mashhur kulgingizni eslayman" kabi) taqiqlanadi.

## 5. Namunalar

- Tug'ilgan kun tabrigi namunasi (otaga): [qwert.uz](https://qwert.uz/2020/04/29/tugilgan-kun-uchun-tabriklar-matni-otaga-2/)
- 8-mart tabrigi namunasi: [baxtiyor.uz](https://baxtiyor.uz/8-mart-tabrik-ayollar-uchun-tabrik-va-tilaklar/)

**LLM uchun yaxshi/yomon misol (`addressee`="Dilnoza opa", `relationship`="ustoz",
`occasion`="Ustozlar kuni"):**

- ✅ Yaxshi: «Hurmatli Dilnoza opa, Sizni Ustozlar va murabbiylar kuni
  bilan chin qalbdan tabriklayman. Sizning sabringiz va bilimingiz
  bizga doim yo'l-yo'riq bo'lgan...» — adresat ismi, hurmat shakli,
  aniq bayram nomi, kasbga mos iliqlik.
- ❌ Yomon: «Salom! Tabriklayman! Sizga baxt tilayman.» — adresat
  ismi/kasbi/bayram nomi ishlatilmagan, "siz" o'rniga "sizga" bilan
  cheklangan sayoz murojaat, hurmat darajasi ustozga mos emas (`respectForm`,
  `personalTouch`, `occasionAuthenticity` uchtasi ham buziladi).

## 6. Ochiq savollar / egasidan kerak narsalar

1. `occasion` erkin matn (raqobatchidagidek) yoki oldindan belgilangan
   ro'yxat (tug'ilgan kun/8-mart/Navro'z/Ustozlar kuni/bitiruv/boshqa)
   bo'lsinmi — ro'yxat bo'lsa janr-xos iboralar promptga aniqroq ulanadi,
   lekin tanlanmagan bayramlar uchun moslashuvchanlik kamayadi.
2. Standart ton "siz" (hurmat) — agar `relationship`="do'st"/"opa-uka"
   bo'lsa "sen" ga o'tish kerakmi, yoki xavfsizroq variant sifatida
   doim "siz" saqlansinmi (madaniy odob nuqtai nazaridan xato qilmaslik
   uchun)?
3. Bitta ovoz yetarlimi, yoki guruh tabrigi (masalan sinf jamoasi
   nomidan) uchun 2+ ovozli variant kelajakda kerak bo'ladimi?
4. Fon musiqasi litsenziya qarori — podkast bilan bir xil ochiq savol
   (`podcast.md` 6-band).
