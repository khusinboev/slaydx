# R2 — Glossariy (atamalar lug'ati, maktab 1–11 va OTM)

AUDIT-20 §1 shabloni bo'yicha. Har faktga URL berilgan; URL yo'q joyda
"aniqlanmadi" deb ochiq qoldirilgan — o'ylab topilmagan.

## 1. Rasmiy shakl/standart

| Hujjat | Raqam/sana | Nima beradi | Manba |
|---|---|---|---|
| DTS (Davlat ta'lim standarti) | VM 187-son, 06.04.2017 (2021+ tahrir) | 3-ilova — fanlar bo'yicha malaka talablari; bu yerda fan tushunchalari ro'yxati emas, balki bitim natijalari (nima BILISHI kerak) tasvirlanadi — bevosita "glossariy" formati emas | [lex.uz/ru/docs/-3153714](https://lex.uz/ru/docs/-3153714?ONDATE=28.04.2021+00) (R1 hisobotidan) |
| Milliy o'quv dasturi (2021+) | Vazirlik konsepsiyasi | 6 komponentdan iborat: fan kontseptsiyasi, bitiruv talablari, o'quv dasturi, fan dasturi, metodika, baholash tizimi — "fan tushunchasi" alohida komponent sifatida ajratilgan (nomlanishi shuni ko'rsatadi, lekin bu bevosita glossariy shakli emas, "tayanch tushunchalar" ro'yxati fan dasturi ichida joylashadi deb taxmin qilinadi) | qidiruv natijasi, to'liq PDF ochilmadi (`uzbmb.uz` sertifikat xatosi bilan bloklandi) — **aniqlanmadi** |
| Fan dasturlari (masalan `uzbmb.uz` qabul dasturlari) | Har fan/sinf uchun alohida PDF | "Tayanch tushunchalar"/"asosiy tushunchalar" bandi borligi qidiruv natijalarida ko'rindi (masalan matematika uchun "to'plam, unsurlar, kesishma, birlashma, ta'rif, aksioma, teorema, isbot") | PDF **to'liq tasdiqlanmadi** — sertifikat xatosi va bo'sh/xato fayl (4.8 KB) tufayli aniq matn ko'rilmadi; qidiruv qisqacha parchasidan olindi, **halollik uchun aniqlanmadi deb belgilanadi** |
| Respublika Millatlararo Terminologiya Komissiyasi (RMTK) | 1984-yil tashkil, Fanlar akademiyasi qoshida | O'zbek tilidagi terminlar tizimini mustahkamlash, ko'plikni cheklash, nomlash tamoyillarini ishlab chiqish | umumiy qidiruv natijasi, aniq hujjat **aniqlanmadi** |
| Davlat tilida ish yuritish va terminologiya qo'mitasi (hozirgi holati noaniq) | — | Bir muddat mavjud bo'lgan, hozir **tiklashni so'rovchi petitsiya** bor — ya'ni institut faol emas yoki tarqatib yuborilgan bo'lishi mumkin | [change.org petitsiyasi](https://www.change.org/p/dr-dilorom-hamroeva-vazirlar-mahkamasi-qoshida-davlat-tilida-ish-yuritish-va-terminologiya-qo-mitasini-tiklash) |
| "O'zbek tilining izohli lug'ati" (5 jildli) | Akademik nashr | Lug'at tuzish konventsiyasi uchun asosiy amaldagi namuna: bosh so'z qalin, alifbo tartibi, ko'p ma'no arab raqami bilan, omonim rim raqami bilan | umumiy qidiruv, aniq nashr ma'lumotlari **aniqlanmadi** (turli yil nashrlari mavjud) |

**Muhim topilma (halollik uchun):** R1 hisobotidagi kabi — glossariy uchun
ham **bitta yagona majburiy DOCX/format standarti** (masalan "band X:
atama, band Y: ta'rif, band Z: manba" tartibida rasmiy buyruq) topilmadi.
Amalda tarqalgan konventsiya — umumiy leksikografiya (lug'atshunoslik)
qoidalari (`O.Usmonov/R.Doniyorov` uslubidagi lug'at tuzilishi misolida):
"Bosh so'zlarning barcha so'z va terminlar alifbe tartibida berilgan va
ular yirik qora harflar bilan terilib" har biri yangi paragrafdan
boshlanadi; ko'p ma'noli so'zda "ma'nolarning har biri arab raqamlari
bilan ko'rsatilgan"; omonimlar "bir-biridan rim raqami bilan ajratilgan"
([tsuull.uz qo'llanma](https://tsuull.uz/sites/default/files/normamatov_kullanma_2.pdf)).
Bu — til/leksikografiya standarti, ta'lim-metodik standart emas; ammo
bizning "10/20/40 atama" formatimiz uchun amaliy asos sifatida yetarli.

### Amaldagi (konvensional) bo'limlar jadvali

| Bo'lim | Majburiymi (amaliyotda) | Izoh |
|---|---|---|
| Sarlavha (fan/mavzu) | Majburiy | |
| Kirish (glossariyning qamrovi haqida 1–2 gap) | Ixtiyoriy, keng tarqalgan | Bizda mavjud (`writeGlossaryWithLlm` `intro`) |
| Atama (bosh so'z, qalin/katta harf) | Majburiy | Leksikografiya konventsiyasi |
| Ta'rif (1–2 aniq gap) | Majburiy | |
| Misol (kontekstda qo'llanish) | Ixtiyoriy, sifatni oshiradi | Raqobatchilarda (Diffit, Twee) standart |
| Manba/etimologiya | Ixtiyoriy, ilmiy lug'atlarda majburiy | Bizning hajmda (o'quv glossariysi, akademik lug'at emas) ortiqcha bo'lishi mumkin |
| Tarjima (ru/en) | Ixtiyoriy, OTM amaliyotida keng tarqalgan | Pastda batafsil |
| Alifbo tartibi | Majburiy | Bizda allaqachon bor (`writeGlossaryWithLlm:323-325`, `Intl.Collator`) |

## 2. Raqobatchilar parametrlari

| Parametr | sodda.ai | MagicSchool (Vocab List Generator) | Twee (Essential Vocabulary) | Diffit (Vocabulary) | Quizlet | Biz olamizmi |
|---|---|---|---|---|---|---|
| Narx | JS orqali yuklanadi, statik holatda ko'rinmadi | — (60+ vosita ichida, alohida narx yo'q) | bepul (ESL vositalar to'plami) | obuna/bepul limit | bepul/Plus obuna | o'zgarmaydi (6000/9000/15000, PM qarori) |
| Manba turi | mavzu | mavzu **yoki manba matn** ("generate from texts") | faqat mavzu | **manba matn/URL/PDF/gacha 10 so'z ro'yxati** — bu ularning asosiy kuchi (matndan chiqarish) | qo'lda kiritish yoki tayyor to'plamdan | bizda faqat mavzu — **manba fayl rejimi yo'q** |
| Daraja/sinf | aniqlanmadi | grade level tanlov | CEFR A1–C2 yoki yosh/grade | reading level moslashtirish (bir necha daraja bir vaqtda) | — | bizda `grade` maydoni umuman yo'q (faqat `TEACHER_FIELDS` umumiy shapka) |
| So'z turkumi (noun/verb/adj) | aniqlanmadi | aniqlanmadi | **bor** — ot/fe'l/sifat/ibora/idioma/frazaviy fe'l | aniqlanmadi | — | keyin — biz uchun kam foydali (fan atamalari ko'pincha ot) |
| Atama soni | aniqlanmadi | aniqlanmadi | aniqlanmadi (belgilanmagan) | ≤10 so'z (manba rejimida) | cheksiz (qo'lda) | bor: 10/20/40, narxga bog'liq |
| Ta'rif + misol | ? | ? | boshqa vosita bilan (Word-Definition Matching) | **ta'rif + kontekstdagi misol jumla** — bizning yondashuvga yaqin | ta'rif (matn), rasm qo'shish mumkin | bizda ta'rif bor, **misol yo'q** |
| Tarjima (til) | 18 til (kontent tili, interfeys emas) | — | — | **60+ tilga tarjima** — kuchli, ayniqsa ko'p tilli sinf uchun | ko'p til (interfeys) | bizda faqat bitta chiqish tili (`language`) — **uch tilli (uz/ru/en) rejim yo'q** |
| Rasm | — | — | — | — | **bor** — Quizlet galereyasidan rasm qo'shish | keyin — flesh kartalar (AUDIT-21) bilan bog'liq bo'lishi mumkin, glossariyda ortiqcha |
| Faoliyat/mashq generatsiyasi | — | **bor** — ro'yxatdan mashq (activities) yaratiladi | **bor** — fill-in-the-gap, matching mashqlari | qo'shimcha savollar/o'qish matni | flashcard/mashq rejimlari | bizda yo'q — DOCX statik lug'at, interaktiv emas (o'yin-xizmatlar dasturida qisman qoplanadi — flesh kartalar) |

## 3. Bizga tavsiya — reyestr

**Turlar** (`GlossaryModel.type`):

- `fan-lugati` (standart) — bitta fan bo'yicha umumiy atamalar (hozirgi xatti-harakat).
- `mavzu-lugati` — bitta tor mavzu/bob (masalan "Hujayra tuzilishi atamalari"), atama soni kamroq bo'lishi mumkin (6–15), ta'riflar tor kontekstga bog'liq.
- `uch-tilli` — har atama uchun `ru`/`en` tarjima ham chiqadi (OTM amaliyotida keng tarqalgan, Diffit/60+ til tarjimasi ham shu ehtiyojni ko'rsatadi). Jadval ustuni kengayadi.
- `imtihon-atamalari` — DTM/attestatsiya kontekstidagi tor, aniq ta'riflangan atamalar (qisqaroq ta'rif, imtihonda so'raladigan darajada).

**Parametrlar** (`id`, tur, variantlar, standart, majburiy, `impacts`):

| id | tur | variantlar | standart | majburiy | impacts |
|---|---|---|---|---|---|
| `topic` | text | — | — | ha | prompt |
| `type` | select | fan-lugati/mavzu-lugati/uch-tilli/imtihon-atamalari | fan-lugati | ha | prompt, structure (jadval ustuni) |
| `subject` | text (ixtiyoriy) | — | — | yo'q | prompt (agar `topic` fan nomidan farqli bo'lsa) |
| `grade` | range (ixtiyoriy) | 1–11 yoki "OTM" | — | yo'q | prompt (ta'rif darajasi — raqobatchilarda `grade level`/CEFR bor, bizda yo'q) |
| `termCount` | chips | 10/20/40 | 10 | ha | prompt, price (o'zgarmaydi — mavjud) |
| `includeExample` | toggle (ixtiyoriy) | ha/yo'q | ha | yo'q | prompt, review (`exampleCoverage`) — hozir promptda yo'q, qo'shish tavsiya etiladi |
| `translationLangs` | multiselect (faqat `type=uch-tilli`) | ru/en | [] | yo'q | prompt, structure (qo'shimcha ustun) |
| `language` | select | uz/ru/en | uz | ha | prompt, structure |
| `extra` | textarea | — | — | yo'q | prompt (bor, ishlaydi) |

**Bo'limlar skeleti:** sarlavha → kirish (qamrov) → atamalar ro'yxati
(alifbo tartibida: atama → ta'rif → (ixtiyoriy) misol → (faqat
`uch-tilli`) ru/en tarjima). Qisqa jadval **ataylab yo'q** — mavjud
qarorda asoslangan (`write-specials.ts:344-353`, ikkinchi nusxa
qo'shimcha qiymat bermaydi).

**Jadval ustunlari** (agar kelajakda `reference` profilida jadval
qo'shilsa — hozir yo'q, lekin `type=uch-tilli` uchun tavsiya): `Atama |
Ta'rif | Ru | En`.

**Hajm chegaralari:** atama soni — narx bilan qat'iy bog'liq (10/20/40),
70% chegara (`collected.length < Math.max(6, Math.ceil(want * 0.7))`)
allaqachon bor va o'zgarmasin. `mavzu-lugati` uchun minimal atama soni
pastroq (6) bo'lishi tavsiya etiladi, chunki tor mavzuda 40 ta chinakam
atama topish qiyin bo'lishi mumkin.

## 4. Sifat mezonlari

**Deterministik qoidalar** (`ReviewCheck` uslubida):

| id | Nima tekshiradi | Chegara |
|---|---|---|
| `termCount` | Yetkazilgan atama soni va'da qilinganga yaqin | ≥70% (mavjud) |
| `alphaOrder` | Atamalar chiqish tilida to'g'ri alifbo tartibida | qat'iy (mavjud, `Intl.Collator`) |
| `defLength` | Ta'rif 1–2 gap, juda qisqa (stub) yoki juda uzun emas | 40–420 belgi (mavjud `clip(…, 420)`, pastki chegara yo'q — **qo'shish tavsiya etiladi**) |
| `noGenericTerm` | Atama umumiy pedagogik so'z emas (kompetensiya, metod, tahlil...) | mavjud (`isGenericGlossaryTerm`, `GENERIC_GLOSSARY` regex) |
| `exampleCoverage` (agar `includeExample`) | Atamalarning kamida X%ида misol bor | ≥60% |
| `duplicateTerm` | Bir xil atama (case-insensitive, tirnoqsiz) takrorlanmagan | mavjud (`seen` Set, `write-specials.ts:296-299`) |
| `noStubDefinition` | Ta'rif atamaning o'zini takrorlamaydi (masalan "Fotosintez — bu fotosintez jarayoni") | tavtologiya tekshiruvi — **yo'q, qo'shish tavsiya etiladi** |

**Judge mezonlari** (3–6, ingliz tilida):

1. `definitionAccuracy` — is each definition factually correct and specific to the stated subject/topic, not a vague generic sentence?
2. `levelFit` — is the explanation depth appropriate for the stated grade/level (school vs university)?
3. `termRelevance` — does every term genuinely belong to the subject/topic, not borrowed from an unrelated domain (e.g., generic pedagogy terms in a biology glossary)?
4. `alphabeticalIntegrity` — (deterministic check backs this, but judge can flag near-duplicates the code missed, e.g. singular/plural variants of the same concept).
5. `exampleQuality` (if present) — does the example sentence use the term in a natural, subject-relevant context rather than restating the definition?

**Halollik chegarasi:** aniq GOST raqami, standart nomi yoki muallif
"lug'at" nomi (masalan "O'zbek tilining izohli lug'ati, 3-jild, 45-bet")
**o'ylab topilmasin** — model manba raqamini bilmaydi, faqat foydalanuvchi
o'zi `extra` orqali kiritganda ishlatilishi mumkin. Hozirgi
`glossarySystemPrompt` da bunday taqiq **aniq yozilmagan** — dars
rejasidagi kabi ("Uydirma muallif va dastur nomi yozmang") qo'shilishi
tavsiya etiladi.

## 5. Namunalar

- Tibbiy terminlar lug'ati (ochiq, ko'p tilli, amaliy namuna: atama →
  ta'rif → rasm): [hesperian.org PDF](https://hesperian.org/wp-content/uploads/pdf/uz_la_wtnd_2015/uz_la_wtnd_2015_gloss.pdf).
- "Kasbiy ta'lim" izohli lug'ati (soha atamalari, ta'lim-metodik
  kontekst): [edu.profedu.uz PDF](https://edu.profedu.uz/media/files/izohli_lugat_Kasbiy_talim_.pdf).
- Leksikografiya konventsiyasi (bosh so'z, ko'p ma'no, omonim
  belgilash): [tsuull.uz normamatov_kullanma_2.pdf](https://tsuull.uz/sites/default/files/normamatov_kullanma_2.pdf).

**LLM uchun yaxshi/yomon misol:**

- ✅ Yaxshi (biologiya, "Fotosintez"): «Fotosintez — yashil o'simliklar
  xlorofill yordamida quyosh energiyasini kimyoviy energiyaga aylantirib,
  karbonat angidrid va suvdan organik moddalar (glyukoza) va kislorod
  hosil qilish jarayoni. Bu jarayon barg hujayralaridagi xloroplastlarda
  kechadi.» — aniq, sohaga xos, tavtologiyasiz.
- ❌ Yomon: «Fotosintez — bu muhim biologik jarayon bo'lib, o'simliklar
  hayotida katta ahamiyatga ega.» — atamaning o'zini takrorlaydi,
  hech qanday aniq mexanizm/misol yo'q, `noStubDefinition` qoidasi buni
  rad etishi kerak.

## 6. Ochiq savollar / egasidan kerak narsalar

1. `type=uch-tilli` (ru/en tarjima) — bu OTM keng tarqalgan amaliyot
   (topilma: umumiy qidiruvda tasdiqlandi, aniq hujjat orqali emas) va
   Diffit kabi raqobatchida (60+ til) kuchli tomon. Bizga narxni
   oshirmasdan (tekis 6000/9000/15000) qo'shish kerakmi, yoki alohida
   narx bosqichi kerakmi?
2. `includeExample` (misol jumla) — hozir promptda yo'q. Har doim
   yoqilgan holda kelishi kerakmi (standart `ha`), yoki foydalanuvchi
   maydoni sifatida ixtiyoriymi?
3. Fan dasturlaridagi rasmiy "tayanch tushunchalar" ro'yxatlarini (DTS
   3-ilova yoki fan dasturi PDF) to'liq tekshirib bo'lmadi (tarmoq/
   sertifikat cheklovlari). Bu ro'yxatlarni curriculum bazasi (R4,
   AUDIT-20 §1 4-dastur) yig'ganda glossariy uchun ham manba sifatida
   ishlatish mumkinmi (masalan fan dasturidan tayanch tushunchalarni
   avtomatik ajratib, glossariy sifatida taklif qilish)?
4. Manba fayl rejimi (Diffit uslubida — matn/PDF yuklab, o'sha matndagi
   atamalarni chiqarish) — bizda hozir yo'q, faqat mavzu asosida yozadi.
   Bu keyingi bosqichda (test/keys kabi `mode: topic|file`) qo'shilishi
   kerakmi, yoki hozircha doirasidan tashqarimi?
