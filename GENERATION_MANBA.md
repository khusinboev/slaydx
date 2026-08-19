# Generation — mavjud manbalar (klonlash to‘xtagan)

Savol: sayt va ikki GitHub loyihadan generation (AI + DOCX/PPTX) uchun nima olish mumkin?

**Qisqa javob:** prompt, titullik shablon, GOST qoidalari, tayyor DOCX **qolmagan**. Ular backend (Celery + LLM) da. Frontend faqat forma + API kontrakt. Lekin kontrakt va ichki `payload` sxemasi yetarli darajada ochiq — o‘z engine ni shu modelga qurish mumkin. Keyingi boyitish internet + OTME/GOST.

---

## 1. Qayerdan qidirdik

| Manba | Generation bormi? |
|---|---|
| `sodda-ai/` | Yo‘q. sodda.**uz** do‘kon RAG boti (`gpt-4o-mini`, mahsulot kartasi). |
| `sodda-ai-mobile/` | Yo‘q. WebView. |
| sodda.ai JS chunklari | Yo‘q. Prompt yo‘q. Faqat API yo‘llari, writer maydonlari, UI matn. |
| sodda.ai API (oldingi sessiya) | **Kontrakt + bitta yozuvchi payload** (ishlar REVOKED, matn to‘lmagan). |
| `sodda-web/lib/generate.ts` | O‘zimiz yozgan **zaif shablon** (8–12 paragraf). LLM yo‘q. |

Xulosa: boshqa projectlardan generation **ko‘chirish mumkin emas**. Faqat **nima yasash kerakligi** (sxema) olingan.

---

## 2. Olingan narsa (o‘z engine uchun spec)

### 2.1 Ish hayoti

```
QUEUED → IN_PROGRESS → COMPLETED | FAILED | REVOKED
```

Yozuvchi oilasi (`work_type`): `referat`, `long writing` (mustaqil ish), `coursework`, `article`, `thesis`, `essay`, `glossary`, `keys`, `methodicdoc` / `texnologik_xarita`.

Yozuvchi LLM (aslida): `gpt-4.1-nano`.  
O‘yin/slayd tomoni: `gemini-2.5-flash`.  
Buni nusxa qilish shart emas — o‘z modelingiz.

### 2.2 Yozuvchi payload (referat / mustaqil ish, jonli obyekt)

Bo‘sh (bekor qilingan) jobdan kalitlar. Matn to‘lmagan — lekin **struktura** shu:

```
work_type, topic, language, doc_count          # "10-15"
author_name, student_info_raw
university_name, department_name, teacher_name
group_name, course, subject_name, city
ministry                                       # "1" = oliy ta'lim
toc_method                                     # "auto" | qo'lda
toc_text
chapter_count, contents_count                  # default 2 bob, 4 reja
plan1, plan2, plan3
subtitles1[], subtitles2[], subtitles3[]
s_content1[], s_content2[], s_content3[]       # bob matnlari
brief, introduction, conclusion, references[]
sections[]
annotation_languages                           # ["uz","en","ru"]
article_type                                   # "standard" | IMRAD
include_images, include_visuals
writing_preference
template_id, content_file, docx_path
llm_model, input_tokens, output_tokens
stage, progress, status
```

Bu — generation state machine: avval reja (`plan*`), keyin ostmavzular, keyin matn, keyin DOCX.

### 2.3 Writer profile (frontend)

```
student_info 300, university_name 300, faculty_name 300,
department_name 300, course 10, group_name 300,
subject_name 300, teacher_name 200, city 100, author_name 70
```

### 2.4 Create API — majburiy maydonlar (422 javob)

| Vosita | Majburiy |
|---|---|
| Insho `/essays` | `topic, page_count, university_name, faculty_name, department_name, subject_name, teacher_name, city` |
| Kurs / referat / mustaqil | `user_id` + `topic` (user_id ni **ko‘chirmang**, token dan oling) |
| Maqola | `topic, author_name, author_degree, author_org, author_email` |
| Tezis | `topic, author_name` |
| Tarjimon | `file, target_language` |
| Slayd create | `content, n_slides, language` |
| Slayd prepare | `presentation_id, outlines, layout` |
| Dars | `topic` |
| Glossariy / keys | mavzu/fan (UI) |
| Xarita | fan, haftalik soat, jami soat (UI) |

### 2.5 Slayd pipeline (faqat bosqichlar)

`create` → `prepare(outlines, layout)` → tahrir → `export/async`.  
101 ta layout oilasi (biologiya, tibbiyot, pitchdeck…). Layout **kodi** ochiq emas (frontend faqat o‘z layoutini compile qiladi).

### 2.6 Test (scope tashqarida, lekin payload bor)

`topic, difficulty=MEDIUM, question_count=15, file_format=docx`.

---

## 3. Nima umuman yo‘q (internetdan yoziladi)

- System / user promptlar
- Universitet titul sahifasi (vazirlik gerbi, «TASDIQLAYMAN», imzo qatori) rasmiy maketi
- Times 14 / 1.5 / 2–2.5 sm / GOST 7.32 yoki OTME uslubiyoti
- Adabiyotlar ro‘yxati formati
- IMRAD bo‘lim matnlari namunasi
- Texnologik xarita jadvali (hafta × soat × metod) rasmiy blank
- Dars ishlanmasi (maqasad, jihoz, bosqichlar) rasmiy blank
- Rezyume ATS shablonlari
- PPTX akademik dizayn
- Tayyor sifatli DOCX namuna (bizdagi joblar bekor, fayl qolmagan)

`sodda-web/lib/generation/` — 2026-08-13 da internet + OTME/GOST asosida **v2 engine** yozildi (titul, mundarija, IMRAD, Times 14 / 1.5 / 3+1.5 sm, adabiyotlar). LLM hali ulanmagan; matn tuzilmaviy. Promptlar `lib/generation/prompts.ts` da.

---

## 4. O‘z generationni qanday qurish (manba yo‘qligi sababli)

1. **State** — yuqoridagi payload ni o‘z DB modelingiz qiling (plan → content → file).
2. **Promptlar** — o‘zingiz yozasiz. Internet + OTME:
   - O‘zbekiston OTME / vazirlik «kurs ishi / bitiruv malakaviy ish» uslubiy ko‘rsatmasi
   - IMRAD (maqola/tezis)
   - GOST 7.1 / 7.32 yoki mahalliy «Adabiyotlar ro‘yxati»
   - Dars texnologik xaritasi (maktab ta’limi)
3. **DOCX** — `python-docx`: titul + mundarija + boblar. Avval **insho** (qisqa).
4. **LLM** — bitta arzon model; yozuvchi oilasi bitta prompt oilasi.
5. Asl `gpt-4.1-nano` / `user_id` body / global list — **nusxa olmang**.

---

## 5. Xulosa

| Olish mumkinmi? | Holat |
|---|---|
| Prompt / sifatli matn / titullik DOCX | **Qolmagan** |
| Job + yozuvchi payload + forma maydonlari | **Olingan** — shu fayl |
| Keyingi ish | Internet + OTME/GOST asosida o‘z prompt va shablon |

Klonlashdan olinadigan generation qismi shu. Qolgani — o‘z boyitish.
