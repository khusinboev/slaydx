# Formalar 3 uchun etalon — AUDIT-12…17 ixcham dizayni

Auditor xulosasi. Manba: `docs/AUDIT-12/13/14/15/16/17.md` + 5 ta komponent
(`SlideComposer`, `ArticleComposer`, `ResumeComposer`, `TranslationForm`,
`ProSlideForm`/`SlideForm` reyestrlari) + ularning umumiy bo'laklari
(`compact.tsx`, `ToolChrome.tsx`). **17 qolgan vosita** (talaba, o'qituvchi
guruhlari + `rasm`) shu etalonga tenglashtiriladi. Eslatma: `rasm`
(`ImageStudio.tsx:61-186`) «umumiy» guruhda bo'lsa ham hech qachon
ixchamlashtirilmagan — u eski `fieldset/legend` uslubida, `ToolChrome`ni
ham ishlatmaydi (o'z sticky footer'ini qayta yozadi,
`ImageStudio.tsx:172-183`). Demak 5 vositadan tashqari «umumiy» guruhda
migratsiya kutayotgan oltinchi forma ham bor.

## 1. Dizayn tili

**Karta tuzilishi va tartib** — har forma `ToolChrome` (`ToolChrome.tsx:7-81`)
ichida 4–6 `Card` (`compact.tsx:18-38`) + 1 yopiq `<details>` «Sozlamalar»:

| Forma | Karta tartibi |
|---|---|
| Slayd/Pro (`SlideComposer.tsx:148-257`) | Mavzu (+til) → Slaydlar soni (narx) → Muallif → Shablon va rang → ▸ Sozlamalar |
| Maqola (`ArticleComposer.tsx:437-712`) | Mavzu va tur → Nashr profili → Mualliflar → Materiallar → Hajm va til → ▸ Sozlamalar |
| Rezyume (`ResumeComposer.tsx:272-610`) | Shaxsiy → Maqsad → Ish tajribasi → Ta'lim·Sertifikat·Tillar → Ko'nikmalar → ▸ Sozlamalar |
| Tarjimon (`TranslationForm.tsx:127-283`) | Manba → Tillar → ▸ Sozlamalar |

Qoida: **mavzu/asosiy kirish birinchi, narxga bevosita ta'sir qiluvchi
parametr (hajm/slayd soni) ikkinchi, shapka/muallif keyin, kamdan-kam
o'zgaradigan sozlamalar ENG OXIRIDA yopiq**. Bitta istisno — Rezyume
«Maqsad» kartasida shablon TANLOVI ham turadi (`ResumeComposer.tsx:355-365`),
chunki u narx yoki AI boyitish qarorini ko'rgan zahoti ko'rinishi kerak.

**Bitta qator = bitta parametr**: `Row` (`compact.tsx:41-65`) — chapda
`7.5rem` kenglikdagi yorliq (+ ixtiyoriy `ⓘ` tooltip `title`/`aria-label`
orqali), o'ngda boshqaruv; mobil (`sm:` dan past, ~640px) da ustma-ust
(`grid-cols-1` → `sm:grid-cols-[7.5rem_1fr]`, `compact.tsx:53`). `wide`
prop butun eni oladi (matn maydonlar, chip guruhlari).

**Boshqaruv tanlovi qoidasi**:
- ≥7 variant yoki uzun ro'yxat (auditoriya 14, tur 9) → `<select>`
  (`SelectField`, `compact.tsx:104-129`, brauzer o'zi, klaviatura tekin).
- 3–6 qisqa variant → `Segmented` (`compact.tsx:68-101`), yorliqlar QISQA
  bo'lishi kerak — qatorga sig'ishi qo'lda nazorat qilinadi
  (`slide-fields.tsx:77`: «segment yorliqlari QISQA — qator ichida sig'sin»),
  komponentning o'zida uzunlik cheklovi YO'Q, faqat `flex-wrap`.
- Ha/Yo'q → `Switch` (`compact.tsx:132-161`, `role="switch"`).
- Ko'p tanlovli erkin/tavsiyali → `Combobox multi` chip (`Combobox.tsx:31-174`)
  yoki oddiy chip guruh (`FigureKindChips`, `ArticleComposer.tsx:104-130`).
- Takrorlanuvchi obyekt qatorlari (ish joyi, muallif, manba) → `RowList`
  (`RowList.tsx:24-82`), har qatorda ↑/↓/× ikon tugmalar (`aria-label`).

**Yig'iq «Sozlamalar»**: yopiq holda `SummaryChips` (`compact.tsx:190-200`)
joriy tanlovlarni qisqa chip qilib ko'rsatadi — foydalanuvchi ochmasdan
holatni ko'radi. Ikki ALOHIDA mexanizm bilan amalga oshirilgan (2-bo'limga
qarang — nomuvofiqlik).

**Narx**: faqat `ToolChrome` pastki sticky tugmasida `data-price-total`
(`ToolChrome.tsx:64-78`), `formatTanga`. Slayd formasi bundan tashqari
«Slaydlar soni» kartasida ham `data-price` bilan takrorlaydi
(`SlideComposer.tsx:221`) — qolgan 4 ta forma buni qilmaydi.

**Majburiy/xato**: `ToolChrome`da bitta umumiy `error` satri
(`text-destructive`, `ToolChrome.tsx:60-62`) — maydon darajasida qizil
chegara/yulduzcha YO'Q, submit bosilganda birinchi yetishmagan maydon
matni ko'rsatiladi (masalan `SlideComposer.tsx:126-133`,
`ResumeComposer.tsx:252-255`). Bezak yulduzcha yo'q — majburiylik faqat
xatoda ko'rinadi.

**Tailwind leksikoni**: karta `rounded-2xl border p-4` (`compact.tsx:30`),
ichki boshqaruvlar `rounded-lg`/`rounded-xl`, matn hajmi `text-[11.5px]`
(karta sarlavhasi, uppercase, `text-muted-foreground`), `text-[13px]`
(yorliq/qiymat), `text-[11px]`/`text-[12px]` (yordamchi matn, chip),
tugma balandligi `h-8`/`h-9` (ixcham input), asosiy CTA `h-12`. Rang
tokenlari semantik (`bg-card`, `border-input`, `text-muted-foreground`,
`bg-primary`/`text-primary-foreground`, `text-destructive`) — qorong'i
rejim uchun alohida klass yo'q, tokenlar o'zi ikkala mavzuda ishlaydi
(`@theme`/CSS token darajasida, bu fayllarda `dark:` faqat ogohlantirish
ranglarida ko'rinadi, masalan `text-amber-600 dark:text-amber-500`,
`ArticleComposer.tsx:569`).

## 2. Komponent kutubxonasi

| Komponent | Props (asosiy) | Qayerda | Qayta ishlatishga tayyor? |
|---|---|---|---|
| `Card` | `title, aside?, children` | Hammasi | Ha |
| `Row` | `label, hint?, wide?, children` | Hammasi | Ha |
| `Segmented` | `options, value, onChange, ariaLabel?` | Hammasi | Ha |
| `SelectField` | `options, value, onChange, ariaLabel` | Hammasi | Ha |
| `Switch` | `checked, onChange, ariaLabel` | Hammasi | Ha |
| `MiniInput` | `label, value, onChange, placeholder?` | Hech qayerda ishlatilmagan (5 tada) | Shubhali — `slide-fields.tsx` muallif maydonlari oddiy `textRow` (raw `<input>`) ishlatadi, `MiniInput`ni emas; kod bor, chaqirilmaydi |
| `SummaryChips` | `items: string[]` | Hammasi (Sozlamalar yopiq holati) | Ha |
| `ToolChrome` | `title, submitLabel, price?, loading?, onSubmit, error?, extra?` | Hammasi (Image'dan tashqari!) | Ha, lekin `ImageStudio` ishlatmaydi |
| `Combobox` | `value, onChange, suggest, multi?, max?, ariaLabel` | Rezyume (lavozim/ko'nikma), Maqola (kalit so'z) | Ha |
| `RowList` | `rows, onChange, render, add, addLabel, max, empty?, name` | Rezyume (4 blok), Maqola (mualliflar, manbalar) | Ha |
| `SourceFileField` | `legend?, fileName, sourceText, onChange, onBusyChange?` | Slayd, Maqola, `StandardForm` (eski) | Qisman — o'z eski `fieldset/Legend` uslubida (`SourceFileField.tsx:73-102`), `compact` rejimi YO'Q, ixcham kartalar ichida vizual og'irroq ko'rinadi |
| `LogoField` | `value, onChange, compact?` | Slayd (`compact`), eski `StandardForm` (`compact=false`) | Ha — ikki rejim bor, lekin `SourceFileField`da yo'q shu naqsh yetishmaydi |
| `Thumb` | `children, scaleHint, small?` | Slayd shablon galereyasi (`TemplateGallery`) | Ha |
| Galereya juft (`XTile` + `XDialog`) | tile: `value,onChange,…`; dialog: `value,onClose,onPick` | `ResumeTemplateDialog` (`ResumeTemplateTile`/`ResumeTemplateDialog`), `ArticleTypeGallery` (`ArticleTypeTile`/`ArticleTypeDialog`), `PublicationProfileDialog` (`PublicationProfileTile`/…Dialog), `TemplateGallery` (slayd, ichkarida o'z tile+dialog holati) | Ha — barcha 4 joyda bir xil naqsh: bitta plitka (haqiqiy chizg'ich bilan preview) → bosilsa `useDialog` modal, grid karta, bosilishi bilan yopiladi |
| `ColorPicker` | `value, onChange` | Faqat slayd (`slide-pickers.tsx:16-42`) | Umumiy naqsh («doira + halqa» tanlov), lekin rezyume palitrasi buni ishlatmaydi — `ResumeTemplateDialog.tsx:139-151` da xuddi shu vizual mustaqil qayta yozilgan |

## 3. Naqshlar

- **Profil standartlari**: `profileDefaults(profile)` (`lib/tools.ts:1278-1291`)
  — `author/position/organization/subject/city` bitta joydan; forma
  muvaffaqiyatli submitdan keyin FAQAT o'zgargan maydonni yozadi —
  `profilePatchFrom(values, profile)` (`lib/profile-sync.ts:20-29`,
  `PROFILE_SYNC_FIELDS` 4 ta maydon). Slayd (`SlideComposer.tsx:262-268`),
  Maqola (`ArticleComposer.tsx:424-428`, faqat 1-muallif), Rezyume
  (`ResumeComposer.tsx:261-264`, faqat `author`) — uchalasida ham xato
  yutiladi (`.catch(() => {})`), generatsiyani to'xtatmaydi.
- **Qoralama** (`form-draft`): `useFormDraft(toolId, {enabled})`
  (`useFormDraft.ts:33-40`) — 1 200 ms debounce, `visibilitychange`/
  `pagehide`da darhol. Rezyume alohida `useResumeDraft` (yupqa o'ram,
  AUDIT-17 WP4 izohi). Slayd formasi qoralama ISHLATMAYDI — bu 4 tadan
  faqat 3 tasida (Maqola, Rezyume) bor naqsh, Slayd va Tarjimonda yo'q.
- **Fayl rejimi**: `SourceFileField` + `modes` (`tool.modes`, Slayd/Maqola/
  eski `StandardForm`) — matn/fayl segment, fayl serverga yuborilib
  `sourceText` qaytadi. Tarjimon FARQLI naqsh ishlatadi — o'zining
  `mode`/`upload` holatini saqlaydi (`TranslationForm.tsx:39-90`), chunki
  fayl matnga AYLANMAYDI (fayl o'zi tarjima qilinadi, `sourceAssetId`).
  Ikkala naqsh ham to'g'ri, lekin BIR XIL komponent emas — «Fayl» tugmasi
  ikki joyda ikki xil UI (SourceFileField dashed katta quti vs
  TranslationForm ixcham `data-upload` qatori).
- **Galereya tanlovi qachon**: shablon/tur/profilning HAQIQIY vizual farqi
  bor va >4 variant → tile+dialog (Rezyume shablon, Maqola tur/profil,
  Slayd shablon). Oddiy qiymat ro'yxati (auditoriya, taqdimot turi) →
  `<select>`. Chegara qattiq belgilanmagan — amalda «vizual preview kerak
  bo'lsa dialog, faqat matn yorliq bo'lsa select» qoidasi ko'rinadi.
- **«Bezak maydon yo'q» zondi — IKKI XIL mexanizm** (muhim nomuvofiqlik,
  4-bo'limga ham qarang): Slayd `lib/generation/slide-params.ts:1-20`
  izohiga ko'ra har parametr `impacts` bilan e'lon qilinadi va
  `tests/slide-params.test.mts` differensial `probeA/probeB` bilan
  tekshiradi; forma qamrovi esa MATN darajasida (`renderSlideParam`
  switch, `slide-fields.tsx:145-261`, test manba kodini skanerlaydi).
  Maqola/Rezyume esa DOM darajasida — har maydon konteyneri
  `data-field={id}` bilan belgilanadi (`ArticleComposer.tsx:52-56`
  izohida aniq aytilgan shart; masalan `ArticleComposer.tsx:441,460,474`)
  va runtime testi shu atributni qidiradi.
- **A11y**: `Segmented`/`Switch` `role="radiogroup"/"radio"`/`role="switch"`
  + `aria-checked` (`compact.tsx:80-100,142-152`); `Combobox` to'liq
  `role="combobox"`+`listbox`+`aria-activedescendant` naqshi
  (`Combobox.tsx:124-170`), klaviatura ↓/↑/Enter/Esc/Backspace
  (`Combobox.tsx:77-95`). `RowList` tugmalari ikon-only, `aria-label`+
  `title` juftlikda (`RowList.tsx:96-99`). Dialoglar `useDialog` orqali
  (Esc, fokus tsikli — `ResumeTemplateDialog.tsx:121`,
  `ArticleTypeGallery.tsx:85`, `PublicationProfileDialog.tsx:108`).
- **Mobil**: alohida sinov topilmadi (grep — `tests/ui/*-composer.test.mts`
  da aniq piksel/viewport testi yo'q); xulq faqat Tailwind `sm:`
  breakpointga (~640px) tayanadi — `Row` ustma-ust bo'ladi
  (`compact.tsx:53`), `Segmented`/chip guruhlar `flex-wrap`. Bu — AUDIT-12
  hujjatida alohida o'lchanmagan, faqat komponent darajasida ta'minlangan.

## 4. Balandlik/ixchamlik me'yori

Faqat AUDIT-12 sonli o'lchov beradi (Chromium, 1400 px, yopiq «Sozlamalar»):
oddiy slayd formasi 3 432 → **1 124 px**, pro 3 877 → **1 111 px**;
«Sozlamalar» ochilganda 1 471 / 1 660 px (`docs/AUDIT-12.md:15-16`).
Erishish usuli: 4 karta + 1 yopiq `<details>`, karta ichida `Row` zichligi
(`py-1.5`, `compact.tsx:53`), qator raqami ↓ dan ko'proq bo'lgan
maydonlarni (auditoriya, tur, matn hajmi, test soni…) BITTA yopiq blokka
yig'ish. Boshqa 4 forma (Maqola, Rezyume, Tarjimon) uchun mustaqil
Chromium o'lchovi **hujjatlashtirilmagan** — faqat karta soni bo'yicha
o'xshashlik bor (4–6 karta + 1 yopiq blok), lekin piksel raqami yo'q.
Bu — 5-bo'limdagi etalon talabiga (band 14) qo'shildi.

## 5. Etalon talablari — checklist (yangi/qayta yasaladigan forma uchun)

1. Butun forma `ToolChrome` ichida — o'z sticky footer/orqaga tugmasini qayta yozmaydi.
2. Kartalar tartibi: mavzu/asosiy kirish → narxga bevosita ta'sir qiluvchi parametr → shapka/muallif → ko'rinish/shablon (bo'lsa) → ▸ Sozlamalar (eng oxirida, yopiq).
3. Har parametr — bitta `Row` (`compact.tsx`), yorliq chapda, boshqaruv o'ngda; izoh faqat `hint` tooltipda, alohida paragraf emas.
4. ≥7 variant yoki uzun ro'yxat → `SelectField`; 3–6 qisqa variant → `Segmented` (yorliq qator ichida sig'ishi tekshirilgan bo'lishi kerak).
5. Ha/Yo'q — faqat `Switch`, checkbox emas.
6. Takrorlanuvchi obyekt (ish joyi, muallif, manba) — `RowList`, alohida erkin matn blok emas.
7. Tavsiyali/ko'p tanlov matn — `Combobox` (chip, ARIA combobox/listbox).
8. Vizual jihatdan farqli variant (shablon, tur, profil) va >4 ta — tile + `useDialog` modal (bitta plitka forma ichida, haqiqiy chizg'ich bilan preview).
9. «Sozlamalar» — yopiq holatda `SummaryChips` bilan joriy tanlovlar ko'rinadi; ochish/yopish indikatori (chevron yoki teng vizual belgi) BOR.
10. Narx faqat `ToolChrome` sticky footerida (`data-price-total`); qo'shimcha joyda takrorlash — faqat narxga eng bevosita bog'liq bitta parametr yonida, izchil qoida bilan.
11. Majburiy maydon — submit vaqtida aniq xato matni (`missingRequired`/`CUSTOM_REQUIRED` bilan bitta manbadan), forma darajasidagi bitta `error` satrida.
12. Har reyestr parametri formada AYNAN bitta joyda chiziladi va buni tasdiqlovchi avtomatik test bor (`data-field` DOM belgisi TAVSIYA ETILADI — Maqola/Rezyume naqshi — chunki runtime va vizual qamrovni bir vaqtda tekshiradi; matn-darajasidagi skanerlash muqobil, lekin yangi formalar uchun `data-field` afzal).
13. Profilga saqlanadigan maydonlar bo'lsa — faqat o'zgargan qiymat `profilePatchFrom` naqshi bilan, xato yutiladi.
14. Yangi forma balandligi Chromium'da 1400 px kenglikda o'lchanadi va hujjatga yoziladi (AUDIT-12 me'yori: yopiq holda ≈1 100–1 200 px).
15. Qoralama kerak bo'lsa — `useFormDraft(toolId, …)`, 1 200 ms debounce + `pagehide` darhol saqlash.
16. Fayl yuklash bitta izchil komponent bilan (`SourceFileField` yoki uning `compact` varianti) — forma o'zining alohida dropzone'ini qayta yozmaydi.
17. A11y: `Segmented`/`Switch`/`Combobox` uchun ARIA rol+holat to'liq; ikon-only tugmalarda `aria-label`.
18. Mobil (≤400 px) da qator ustma-ust tushishi qo'lda tekshiriladi (hozircha avtomatik test yo'q — checklist buni majburiy qiladi).
19. Qorong'i rejim — faqat semantik token (`bg-card`, `text-muted-foreground`…), qo'lda `dark:` klass faqat ogohlantirish/status ranglarida.
20. Narx serverda qayta hisoblanadi (`priceFor`), formadagi ko'rsatkich faqat vizual — bitta manbadan (`lib/tools.ts`).
21. Har forma uchun 3 bosqichli test: mutatsiya (registry/probe), `tests/viewer/*-form.test.mts` (SSR qamrov), `tests/ui/*-composer.test.mts` (interaktiv, jsdom).
22. Galereya/dialog komponentlari `useDialog` (Esc, fokus tsikli) orqali — qo'lda `onKeyDown`/focus-trap yozilmaydi.
23. Standart (default) qiymatlar bitta joyda e'lon qilinadi (`*_DEFAULT` konstantalar) — forma, narx va dvigatel bir xil standartni o'qiydi.
24. Yopiq «Sozlamalar»dagi chip matni — reyestr yorlig'i bilan bir xil manbadan (alohida qo'lda yozilgan matn emas).
25. Yangi ixcham komponent kerak bo'lsa avval `compact.tsx`ga qo'shiladi (masalan hozir yo'q — `SettingsDetails`), keyin forma undan foydalanadi — hand-rolled dublikat yaratilmaydi.

## 6. Etalon ichidagi nomuvofiqliklar (5 forma orasida)

1. **«Sozlamalar» chevron indikatori** — Slayd/Tarjimon `▸` bilan
   (`SlideComposer.tsx:247`, `TranslationForm.tsx:260`), Maqola/Rezyume da
   umuman YO'Q (`ArticleComposer.tsx:611-626`, `ResumeComposer.tsx:548-559`
   — faqat `justify-between`, ochilish-yopilish vizual belgisiz).
2. **«Sozlamalar» mexanizmi** — Slayd/Tarjimon native uncontrolled
   `<details className="group" data-settings>` + CSS `group-open:`
   (`SlideComposer.tsx:244`), Maqola/Rezyume esa React holatli
   `open={settingsOpen} onToggle=…` (`ArticleComposer.tsx:607-609`,
   `ResumeComposer.tsx:543-545`) — bir xil vizual natija, ikki xil kod yo'li.
3. **«Sozlamalar» konteyneri `Card` komponentidan foydalanmaydi** — barcha
   4 formada `bg-card mb-3 rounded-2xl border p-4` qo'lda takrorlanadi
   (`Card` mavjud, lekin bu yerda chaqirilmaydi) — umumiy `compact.tsx`da
   mos primitiv yo'q.
4. **«Bezak maydon yo'q» qamrov testi** — Slayd matn-darajasida (manba
   kodi skaneri), Maqola/Rezyume DOM `data-field` atributi bilan (3-bo'limga
   qarang) — bitta loyihada ikki mustaqil ta'minot mexanizmi.
5. **Fayl yuklash UI** — `SourceFileField` (katta dashed quti, eski
   `fieldset/Legend`) Slayd/Maqolada, Tarjimonda esa butunlay boshqa,
   ixchamroq `data-upload` qatori (`TranslationForm.tsx:157-195`) — bir xil
   vazifa, ikki mustaqil komponent.
6. **Narxni qayta ko'rsatish** — faqat Slayd «Slaydlar soni» kartasida
   `data-price` bilan takrorlaydi (`SlideComposer.tsx:221`); Maqola/Rezyume/
   Tarjimon buni qilmaydi.
7. **Qoralama (`form-draft`) qamrovi** — Maqola va Rezyumeda bor, Slayd va
   Tarjimonda yo'q (Slayd forma holati faqat `useState`, sahifa yangilansa
   yo'qoladi).
8. **`MiniInput` komponenti chaqirilmaydi** — `compact.tsx`da e'lon
   qilingan, lekin 5 ta formaning birortasi ishlatmaydi (muallif maydonlari
   `textRow` xom `<input>` bilan, `slide-fields.tsx:96-109`) — o'lik kod
   yoki hali joylashtirilmagan naqsh.
9. **Rang/palitra tanlash vizual komponenti ikki marta yozilgan** —
   `ColorPicker` (`slide-pickers.tsx:16-42`, faqat Slayd) va
   `ResumeTemplateDialog` ichidagi qo'lda `size-5 rounded-full`
   palitra tugmalari (`ResumeTemplateDialog.tsx:139-151`) — bir xil
   vazifa («doira + tanlangan halqa»), umumiylashtirilmagan.
10. **Rezyume narxi `tool.basePrice` bilan statik** (`ResumeComposer.tsx:276`),
    qolgan 3 tasi `priceFor(tool, values)` bilan dinamik — bu qasddan
    (rezyume narxi hammasi ichida, tekis 3 000), lekin kod darajasida
    formalar orasidagi yagona "narx bitta funktsiyadan" qoidasi bu yerda
    buziladi (natija bir xil, lekin naqsh boshqa).
