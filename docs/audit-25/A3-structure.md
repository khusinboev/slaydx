# A3 — Struktura, bloklar, parametrlar, narx (AUDIT-25)

Doirasi: `lib/generation/slide-templates.ts`, `slide-blocks.ts`, `slide-purpose.ts`,
`slide-params.ts`, `slide-audience.ts`, `meta.ts`, `lib/tools.ts` (slide/pro-slide),
`components/forms/slide-fields.tsx`+`SlideComposer.tsx`+`ProSlideForm.tsx`,
`tests/slide-params.test.mts`, `tests/slide-blocks.test.mts`, `tests/slide-length.test.mts`.
READ-ONLY audit — S1–S4 (`docs/AUDIT-25.md`) NOT re-reported. Kod hali S1–S4 tuzatishlaridan
OLDINGI holatda (`Bajarilish yozuvi` bo'sh) — quyidagi topilmalar shu holatga qarshi.

## Topilmalar

### A3-01 — `quizCount: 0` ("Testsiz") ikkita taqdimot turida e'tiborsiz qoldiriladi — P1

**Location:** `lib/generation/slide-blocks.ts:415` (`blocksToBeats`), `lib/generation/slide-purpose.ts:48,50`
(`open_lesson`, `training` — `blocks` ro'yxatida `"test"` standart YOQILGAN),
`components/forms/slide-fields.tsx:210-215` (`quizCount` chipi, standart qiymat 0 = "Testsiz").

**Evidence.** `blocksToBeats`:
```ts
const quizCount = (meta.quizCount ?? 0) > 0 ? meta.quizCount : QUIZ_COUNT_FALLBACK; // = 3
```
Bu qator `meta.quizCount === 0` holatini "foydalanuvchi 0 ni ANIQ tanladi" bilan "foydalanuvchi
umuman tanlamadi" holatidan AJRATA OLMAYDI — ikkalasi ham `0`. `testOn` esa `meta.blocks`dagi
`"test"` mavjudligidan keladi, `quizCount`dan mustaqil. `PURPOSE_DEFAULTS.open_lesson.blocks` va
`.training.blocks` ikkalasi ham `"test"`ni STANDART yoqadi. Natija: foydalanuvchi
"Taqdimot turi: Ochiq dars / attestatsiya" yoki "Trening" ni tanlaydi, "Nazorat testi" chipida
**"Testsiz" (0) ko'rinib turadi** (`settingsSummary`, `slide-fields.tsx:274-277`: `q ? ... : "Testsiz"`),
lekin haqiqiy dekada **3 ta test slaydi + kalit** chiqadi — chipning ko'rsatgan holati bilan
haqiqiy chiqish ZID.

Bu **testda bilib qoldirilgan** (`tests/slide-blocks.test.mts:388-391`):
```ts
// Blok bor, son yo'q — qator baribir chiqadi (standart son rejada).
assert.match(promptFor({ blocks: "reja,test", quizCount: 0 }), /quiz layout: HAR quiz slaydida/);
```
— ya'ni "block bor + quizCount 0" birikmasi ataylab "standart son" beradi. Muammo shundaki, forma
BU BIRIKMANI foydalanuvchiga har doim "Testsiz" deb ko'rsatadi, chunki chip qiymati (0) va "hali
tegilmagan" holati ajratilmagan.

**Kimga tegishli:** `SlideForm` (oddiy "Slayd") uchun bu **chiqib bo'lmaydigan** holat —
`blocks` maydoni `tools: ["pro-slide"]` (`slide-params.ts:107`), ya'ni oddiy slayd formasida
"Tuzilma bloklari" chipi UMUMAN chizilmaydi (`slide-fields.tsx:186-195` faqat pro-slide uchun
render qilinadi, `SLIDE_FIELD_ORDER` `blocks`ni o'z ichiga olmaydi — chunki `slideParamsFor("slide")`
`blocks`ni qaytarmaydi). Ya'ni oddiy "Slayd" vositasida "Ochiq dars" yoki "Trening" turini
tanlagan HAR BIR foydalanuvchi 3 ta test slaydidan qutula olmaydi — "Nazorat testi: Testsiz"
chipi shu ikki tur uchun **butunlay bezak**. Pro-slide foydalanuvchisi bu holatni faqat
"Tuzilma bloklari" chipidan "Test"ni QO'LDA o'chirib chetlab o'tishi mumkin (`quizCount` chipi
orqali EMAS).

**Proposed fix (P1 dvigatel, `slide-blocks.ts`):** `DocMeta.quizCount`ni "tanlanmagan" holatidan
ajratish (masalan `undefined` vs `0`ni `extractMeta`da saqlab qolish, yoki `blocksToBeats`ga
alohida `quizCountSet: boolean` uzatish) — foydalanuvchi ANIQ 0 tanlasa `test` bloki `purposeDefaults`dan
kelgan bo'lsa ham chiqarib tashlanishi kerak. Effort: kichik (bitta signalni yo'ldan o'tkazish),
lekin `blocksToBeats`, `meta.ts`, `structure.ts` promptini va mos testlarni yangilashni talab qiladi.

---

### A3-02 — `agendaSlide` faqat OLIB TASHLASHI mumkin, QO'SHA OLMAYDI — `pitch`/`training`da reja slaydi umuman yo'q — P2

**Location:** `lib/generation/slide-blocks.ts:441` (`keepAgenda`), `slide-purpose.ts:50,52`
(`training.blocks`, `pitch.blocks` — ikkalasida ham `"reja"` YO'Q), `slide-fields.tsx:224-225`
(`agendaSlide` — standart `true`, yorliq "Reja slaydi").

**Evidence:**
```ts
const keepAgenda = on.some((b) => b.id === "reja") && meta.agendaSlide !== false;
```
`keepAgenda` IKKI shartning KONYUNKSIYASI: `"reja"` blok bo'lishi VA `agendaSlide !== false`.
`agendaSlide` faqat SO'NDIRUVCHI — u `"reja"` yo'q joyga hech qachon qo'sha olmaydi. `training` va
`pitch` standart bloklarida `"reja"` yo'q (`PURPOSE_DEFAULTS.training.blocks = ["maqsadlar",
"motivatsiya","amaliyot","test"]`, `.pitch.blocks = ["motivatsiya","diagramma"]`), va shu ikki
shablonning O'Z `beats`ida ham `agenda` layout yo'q (`pitch`/`lesson` beats — tekshirildi, ikkalasida
ham `agenda` mavjud emas). Demak: foydalanuvchi "Taqdimot turi: Trening" yoki "Taklif / marketing"
ni tanlaydi, forma "Reja slaydi" o'chirg'ichini **YOQIQ** ko'rsatadi (standart `true`), lekin
dekada HECH QACHON reja/agenda slaydi chiqmaydi — oddiy "Slayd" vositasida buni tuzatishning
YO'LI YO'Q (`blocks` maydoni yo'q, yuqoridagi A3-01 bilan bir xil sabab).

**Fix ikki yo'nalishda mumkin (birortasi kifoya):** (a) `agendaSlide === true` bo'lsa va foydalanuvchi
buni FORMADA aniq yoqqan bo'lsa, `"reja"` blokini majburan qo'shish (A3-01dagi "aniq tanlandimi"
signaliga bog'liq); (b) forma matnini to'g'irlash — bu ikki tur uchun o'chirg'ichni yashirish/izohlash
("bu tur uchun reja slaydi yo'q"). Effort: (b) kichik (P4, `slide-fields.tsx`/`purposeDefaults`
metama'lumotidan `hasAgenda` bayrog'i), (a) o'rta (P1 bilan bir yo'lda ketishi kerak).

---

### A3-03 — `deliveredCount()` pro-slide uchun HECH QACHON ishlamaydi — qisman qaytarish yo'q — P1

**Location:** `lib/generation/delivered.ts:283-301` (`switch (meta.toolId) { case "slide": ...
default: return undefined; }` — `"pro-slide"` case YO'Q), chaqiruvchi `lib/generation/index.ts:530,547`
(`if (tool.id === "slide" || tool.id === "pro-slide") { ... file.delivered = deliveredCount(meta,
slideDoc); }` — izoh: **"`pro-slide` ham shu dvigatel"**, lekin `deliveredCount` buni bilmaydi).

**Evidence.** `DocMeta.toolId` `extractMeta`da `tool.id` dan to'g'ridan-to'g'ri olinadi
(`meta.ts:192`), ya'ni pro-slide uchun `meta.toolId === "pro-slide"` (`lib/types.ts:5` — alohida
`ToolId`). `deliveredCount`ning miqdor-hisoblovchi `switch`i:
```ts
switch (meta.toolId) {
  case "slide": want = meta.targetPages; got = doc.slides?.length ?? 0; unit = "slayd"; break;
  case "glossary": ...
  case "texnologik-xarita": ...
  default: return undefined;   // ← "pro-slide" shu yerga tushadi
}
```
`"pro-slide"` case yo'q → default → `undefined`. Bu esa `file.delivered = deliveredCount(...)`
orqali BuiltFile.delivered = undefined bo'lib qoladi, ya'ni:
  1. **Slayd soni kamomadi qaytarilmaydi.** Pro-slide narxi `slideCount × 2 000` (`priceFor`,
     `lib/tools.ts:1477-1481`) — ya'ni loyihaning o'zi tan olgan tamoyil bo'yicha ("har parametr
     o'lchanadigan ta'sir qiladi") slayd soni to'g'ridan-to'g'ri pulga bog'langan eng qimmat
     parametr, lekin sifat darvozasidan o'tgan (≥0.85 floor) qisman kamomad — masalan 30 so'ralib
     26 slayd chiqqan (60 000 → amalda 52 000lik ish) — HECH QANDAY qaytarish signalisiz to'liq
     pul bilan yopiladi.
  2. **AI rasm kamomadi ham qaytarilmaydi.** `imagesDelivered`/`worse(byCount, imagesDelivered(...))`
     qatoriga umuman yetib bormaydi (funksiya `default:` da erta qaytadi) — pro-slide aynan "har
     mos slaydga AI rasm (Gemini)" va'da qiladigan vosita (`lib/tools.ts:363-367`), ya'ni bu yo'qotish
     eng ko'p aynan shu vositaga tegishli.
  3. Bu holat **oddiy "Slayd" (`toolId: "slide"`) uchun ISHLAYDI** — faqat "pro-slide" branch'i
     yo'q, ya'ni bu qoldirib ketilgan `case`, tizimli emas.

Differensial `SLIDE_PARAMS` zondi buni ushlamaydi, chunki `slideCount`ning e'lon qilingan
`impacts: ["beats", "price"]` ro'yxatida `"delivered"` degan ta'sir turi umuman yo'q
(`SlideParamImpact` tipida `"delivered"` degan qiymat yo'q) — ya'ni bu teshik reyestr-darajasidagi
kafolat doirasidan tashqarida.

**Proposed fix (owner: worker/pricing paketi, `delivered.ts`):**
```ts
case "slide":
case "pro-slide":
  want = meta.targetPages; got = doc.slides?.length ?? 0; unit = "slayd"; break;
```
va pastdagi `if (meta.toolId !== "slide") return byCount;` qatorini ham (`delivered.ts:301`)
`toolId !== "slide" && toolId !== "pro-slide"` ga o'zgartirish — aks holda `pro-slide`da
`imagesDelivered` hamon hisoblanmaydi. Effort: kichik (ikki qator), lekin YANGI moliyaviy
xatti-harakat — sinov: pro-slide'da qisman slayd/rasm kamomadi `refundPartial`ni chaqirishini
tekshiruvchi test yo'q, qo'shilishi kerak (mutatsiya: `case "pro-slide"`ni olib tashlab test
qizarishini tasdiqlash).

---

### A3-04 — Uzunlik shartnomasi ("deka === so'ralgan slayd soni") ko'p bloklik turlarda tekshirilmagan va buziladi — P1/P2

**Location:** `tests/slide-length.test.mts:78-111` (supurish faqat `slidePurpose`siz, ya'ni
`blocks = ["reja"]` bilan ishlaydi — `build()` `v`da `slidePurpose`/`blocks` hech qachon
belgilanmaydi), `lib/generation/slide-blocks.ts:376-379` (6-qoida: "BLOKLAR HECH QACHON
TASHLANMAYDI... deka `want` dan UZUN chiqadi").

**Evidence.** `slide-length.test.mts` sarlavhasidagi "UZUNLIK SHARTNOMASI" (`yakuniy deka uzunligi
=== wantSlides(meta, tpl)`) — loyihaning o'zi buni ENG MUHIM kafolat deb ataydi (pro-slide narxi
to'g'ridan-to'g'ri shu songa bog'langani uchun). Lekin supurish (`test("supurish: yakuniy deka
uzunligi HAR DOIM wantSlides ga teng")`) `v = { slideCount, quizCount, speakerNotes, agendaSlide,
titleSlide, slideTemplate }` — **`slidePurpose` yoki `blocks` HECH QACHON o'rnatilmaydi**, ya'ni
`meta.blocks` doim `purposeDefaults("general").blocks = ["reja"]` (1 blok) + ehtimol `test` guruhi.
Bu — 9 ta taqdimot turining ENG KICHIGI (blok sonida). `blocksToBeats`ning 6-qoidasi esa aynan
ko'p bloklik kombinatsiyalarda (`lesson`: 5 blok, `open_lesson`: 6, `training`: 4, `defense`: 4)
kichik `slideCount`da ishga tushadi: bloklar soni `bodyWant`dan oshsa, funksiya ularni TASHLAMAYDI,
o'rniga deka `want`dan UZUN chiqadi.

Kod bo'yicha qo'lda hisoblab chiqarilgan (yugurtirmasdan, faqat `blocksToBeats` mantig'idan —
pastdagi jadvalga qarang): `want=4` bilan **7 ta turdan 7 tasi** (general va pitch'dan tashqari
barchasi) va'da qilingan slayd sonidan 1.5–2× KO'P slayd yetkazadi:

  - `open_lesson`, `slideCount=4` → dekada 8 slayd chiqadi (4 emas);
  - `training`, `slideCount=4` → 6 slayd;
  - `lesson`/`lecture`/`seminar`/`report`/`defense`, `slideCount=4` → 5–7 slayd.

Bu foydalanuvchiga ZARAR EMAS (ko'proq beriladi, kam emas — `deliveredCount` shuning uchun bu
holatni "kamomad" deb hisoblamaydi, `got >= want`). Lekin ikki narsa buziladi:
  1. **Narx-uzunlik shartnomasi** — pro-slide'da "har slayd 2 000 tanga" reklama qilinadi
     (`SlideCountField`, `slide-fields.tsx:131`); `slideCount=4` (8 000 tanga) tanlagan foydalanuvchi
     8 ta slayd olsa, HAQIQIY narx slaydiga 1 000 bo'ladi — forma va'da qilgan formula amalda
     saqlanmaydi (garchi foydalanuvchi yutsa ham).
  2. **Testlash bo'shlig'i.** Loyihaning o'zi "UZUNLIK SHARTNOMASI"ni eng muhim invariant deb
     ataydi, lekin uni haqiqiy `purposeDefaults` blok to'plamlari bilan SINAMAYDI — aynan shu
     to'plamlar production'da ishlatiladigan yagona to'plamlar (`slidePurpose` formada standart
     `"general"` bo'lsa ham, forma foydalanuvchiga 9 ta turni taklif qiladi va ular uchun
     shartnoma HECH QACHON tekshirilmagan).

**Proposed fix (owner: P1 dvigatel + P5 tekshiruv):** `slide-length.test.mts` supurishiga
`slidePurpose`/`blocks = PURPOSE_DEFAULTS[p].blocks` o'lchovini qo'shish (9 tur × slideCount
supurishi) — bu S1 fix (`planCapacity`) bilan bir yo'lda ketishi tabiiy, chunki ikkalasi ham
"bloklar sig'imga sig'maydi" degan bitta muammoning ikki ko'rinishi (S1 — band/slayd mos
kelmasligi; A3-04 — uzunlik shartnomasining o'zi). Effort: o'rta (test supurishini kengaytirish +
`blocksToBeats`ning 6-qoidasini `planCapacity` bilan muvofiqlashtirish, aks holda `planCapacity`
formada "N band sig'adi" desa-yu, boshqa bloklar sabab deka baribir uzayib ketishi mumkin).

---

### A3-05 — `inferSlideTemplate` eng ko'p uchraydigan o'zbekcha "___ darsi" iborasini tanimaydi — P2

**Location:** `lib/generation/slide-templates.ts:497-518` (`inferSlideTemplate`), qator 510:
```ts
if (/dars ishlanma|dars rejasi|ochiq dars|sinf soati/.test(t)) return "lesson";
```

**Evidence.** Bu qator faqat 4 ta QAT'IY ibora bilan mos keladi. O'zbek maktab o'qituvchisi
odatiy mavzuni ko'pincha shunday kiritadi: "5-sinf matematika darsi: Kasr sonlar",
"Biologiya darsi — Fotosintez", "Ona tili darsi: Ot so'z turkumi" — bularning HECH biri
`dars ishlanma`/`dars rejasi`/`ochiq dars`/`sinf soati` iborasini o'z ichiga olmaydi (faqat
yalang'och "**darsi**" so'zi bor), shuning uchun regex mos kelmaydi va funksiya ro'yxatning oxiriga
(`return "lecture";`, qator 517) tushib qoladi — "Ma'ruza" shabloni (`academic` vizual, reja→
tushuncha→mexanizm→xulosa), "Dars/trening" (`circle` vizual, maqsad→mashq→mustahkamlash) EMAS.

Bu faqat "auto" YO'LIDA sodir bo'ladi (`resolveDeckTemplate`, `slide-write.ts:866-870`):
`slidePurpose` (standart `"general"`, `templateId: "auto"`) VA `slideTemplate` (standart `"auto"`)
IKKALASI HAM standart qiymatida qolganda — ya'ni foydalanuvchi na "Taqdimot turi" dropdown'iga, na
galereyadagi shablonga tegmagan, faqat mavzu yozgan HOLAT — bu forma standart holati, demak eng
ko'p uchraydigan holat. `PURPOSE_DEFAULTS.lesson.templateId = "lesson"` ANIQ — lekin foydalanuvchi
"Taqdimot turi" ni qo'lda "Dars (yangi mavzu)" ga o'tkazmasa (buni bilishi shart emas — u shunchaki
mavzu yozadi), inferSlideTemplate yagona yo'l va u "darsi" so'zini tanimaydi.

**Proposed fix (owner: P1/P2, `slide-templates.ts`):** regex'ga yalang'och `\bdars(i|imiz)?\b`
(lekin "ma'ruza"/"seminar" bilan kesishmasin — ehtiyotkorlik bilan) yoki kamida `"\bdarsi\b"`
qo'shish. Effort: kichik (bitta regex qatori + `inferSlideTemplate`ning mavjud test to'plamiga
yangi holat).

---

### A3-06 — "Reja bandlari" forma yorlig'i hozirgi kod ta'sirini oshirib ko'rsatadi — P3

**Location:** `components/forms/slide-fields.tsx:198` — `hint="Reja slaydidagi va **tuzilmadagi**
band soni."`

**Evidence.** Hozirgi kodda (`SLIDE_BLOCKS.reja.role`, `slide-blocks.ts:50`) `planItems` FAQAT
reja/agenda slaydining o'z matn ko'rsatmasiga tushadi (`"Reja — aynan ${m.planItems} ta band"`).
U dekaning tuzilmasiga (necha content-slayd bo'lishi, ular reja bandlariga mos keladimi) HECH
QANDAY ta'sir qilmaydi — aynan shu narsa AUDIT-25 S1 ning o'zi ("reja — bezak"). Hint matni
"tuzilmadagi band soni" deb, xuddi `planItems` deka STRUKTURASINI ham nazorat qilayotgandek
tuyuladi — bu S1 tuzatilgandan (plan-slayd shartnomasi, `planCapacity`) KEYIN to'g'ri bo'ladi,
lekin HOZIRGI koddan oldinroq yozilgan (yoki kelajakni oldindan va'da qiladi). Amaliy oqibat: agar
S1 fix boshqa fayl to'plamida (P1) birinchi bo'lib chiqsa-yu, forma matni allaqachon shu va'dani
bergan bo'lsa, foydalanuvchi "tuzilma" so'ziga ishonib noto'g'ri kutish bilan qoladi hozircha.

**Proposed fix (owner: P4 forma):** S1/`planCapacity` merge bo'lgach hint avtomatik to'g'ri
bo'ladi — agar undan OLDIN alohida deploy bo'lsa, matnni vaqtincha "Reja slaydidagi band soni"ga
qisqartirish kerak. Effort: juz'iy (bitta satr), lekin **ketma-ketlikka bog'liq** — shuning uchun
P4 buni P1 merge tartibiga bog'lab qo'ysin.

---

## Blok × maqsad × slaydlar soni — sig'im jadvali (S1 ni miqdorlashtirish)

Usul: `bodyWant = slideCount − 2` (titul + yopilish standart yoqiq holatda); `content = bodyWant −
blockSlotsUsed`, bunda `blockSlotsUsed` — `blocksToBeats`ning o'zi kafolatlagan invariant
("blok beat'lari soni ≤ bodyWant" yoki, sig'masa, bloklar SAQLANADI va tana o'sadi — 6/8/9-qoida,
`slide-blocks.ts:462-517`). `quizCount`/`internetSearch` standart (forma) qiymatlarida:
`open_lesson`/`training` — QUIZ_COUNT_FALLBACK=3 (A3-01 sababli), qolganlarida test yo'q,
`internetSearch=false`, `speakerNotes=true` (javoblar kaliti yo'q). Qo'lda hisoblangan (kod
mantig'idan, yugurtirilmagan) — P1 buni `planCapacity` bilan tasdiqlashi kerak.

`0†` = deka SO'RALGANDAN uzunroq chiqadi (bloklar tashlanmagani uchun, A3-04) — ko'rsatilgan son
o'sha holatdagi CONTENT slaydlar soni, jami slayd soni emas.

| Taqdimot turi | Standart bloklar | 4 | 6 | 8 | 10 | 12 | 16 |
|---|---|---|---|---|---|---|---|
| `general` | reja | 1 | 3 | 5 | 7 | 9 | 13 |
| `lesson` | reja,maqsadlar,motivatsiya,amaliyot,uyga_vazifa | **0†** | **0†** | **1** | 3 | 5 | 9 |
| `lecture` | reja,maqsadlar,adabiyotlar | **0†** | **1** | 3 | 5 | 7 | 11 |
| `seminar` | reja,amaliyot,jadval | **0†** | **1** | 3 | 5 | 7 | 11 |
| `open_lesson` | reja,maqsadlar,motivatsiya,amaliyot,**test**,uyga_vazifa | **0†** | **0†** | **0** | **0** | 2 | 6 |
| `report` | reja,diagramma,jadval | **0†** | **1** | 3 | 5 | 7 | 11 |
| `training` | maqsadlar,motivatsiya,amaliyot,**test** | **0†** | **0†** | **0** | 2 | 4 | 8 |
| `defense` | reja,diagramma,jadval,adabiyotlar | **0†** | **0** | 2 | 4 | 6 | 10 |
| `pitch` | motivatsiya,diagramma | **0** | 2 | 4 | 6 | 8 | 12 |

**Eng yomon 5 katak** (0 content, `†` YO'Q — foydalanuvchiga hech qanday "deka uzunroq chiqdi"
signali bo'lmagan holda AYNAN so'ralgan uzunlikda mazmun slaydi NOL):

1. `open_lesson`, slaydlar=**10** (default `SLIDE_DEFAULT`ga eng yaqin standart tanlov) — 0 ta
   mazmun slaydi; bu aynan `docs/AUDIT-25.md`dagi jonli deka misoli (Orol dengizi, 10 slayd, reja
   4 band, mazmun 0) bilan mos tushadi.
2. `training`, slaydlar=**8** — 0 ta mazmun slaydi.
3. `open_lesson`, slaydlar=**8** — 0 ta mazmun slaydi.
4. `defense`, slaydlar=**6** — 0 ta mazmun slaydi (himoya taqdimoti — eng yuqori stavka ishi).
5. `pitch`, slaydlar=**4** (minimal ruxsat etilgan son) — 0 ta mazmun slaydi.

Standart `slideCount` qiymatlari — oddiy slayd `SLIDE_DEFAULT=10`, pro-slide `PRO_SLIDE_DEFAULT=12`
(`slide-params.ts:47,59`) — ya'ni `open_lesson` uchun ENG KO'P tanlanadigan (o'zgartirmasdan
qoldirilgan) standart uzunlikning O'ZI nol-mazmun natija beradi.
