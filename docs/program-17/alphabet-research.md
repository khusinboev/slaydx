# Uzbek script converter: alphabet research (2026-10-22)

> **Official source verified (2026-10-23):** https://lex.uz/docs/-8548754 — Law ЎРҚ-1184 «Лотин ёзувига асосланган ўзбек алифбосини жорий этиш тўғрисида»ги Қонунга ўзгартириш киритиш ҳақида, signed 21.10.2026, effective 22.04.2027 (six months after publication, Art. 4). Art. 1 alphabet, 28 letters + tutuq belgisi ʼ, in order: A B D E F G Ğ H I J K L M N O Ö P Q R S Ş Ç T U V X Y Z. There is no separate «Ng» letter, so ng is written as two letters. Ö/Ğ replace Oʻ/Gʻ and Ş/Ç replace Sh/Ch; the law does not spell out the mapping, it follows from the table. Art. 2: old forms stay valid until the effective date. Art. 3: the Cabinet adopts an implementation programme within 2 months. Owner decisions pending on the exception-list proofreader.


Scope: free converter, 3 scripts (Cyrillic, current Latin "old", NEW Latin), 6 directions.
Method: web search + page fetch through a summarising tool. lex.uz, kun.uz and the npm/socket pages were not directly
readable (403 or not returned), so every claim below is from secondary pages unless stated. Anything not read in an official
text is marked UNCONFIRMED. Rules in section 4 marked [K] come from background knowledge of the 1995 Latin rules, not re-fetched.

## TL;DR

- The new Latin alphabet is real and very recent. It is a LAW (not a decree): "Amendments to the Law 'On the Introduction of the
  Uzbek Alphabet Based on the Latin Script'" (the base law is from 2020). Legislative Chamber passed it 2026-07-07, Senate approved
  2026-09-10, President signed 2026-10-21 (Uzbek Language Day). Reported effective date: 2027-04-22 (one outlet, UzDaily); another
  outlet says "six months after publication". Law number: NOT FOUND, check lex.uz.
- Change is exactly 4 letters: Oʻ->Ö, Gʻ->Ğ, Sh->Ş, Ch->Ç (upper and lower). 28 letters + 1 apostrophe. "Ng" stops being an
  independent letter; how it is written is deferred to the spelling rules (UNCONFIRMED; most likely still "ng").
- Apostrophe is retained (gov.uz). Only used for tutuq (ʼ) now; the ʻ after o/g disappears because of Ö/Ğ.
- Best base: `alifbo` (npm + PyPI, MIT, TypeScript, supports all three scripts incl. the new Latin). Very young (8 stars), so
  adopt it behind our own wrapper and own the test corpus and exception list.
- Exception dictionary: start with a few hundred entries; plan ~1,000 for good quality (estimate, not measured).

## 1. Sources

Official / near-official:
- gov.uz, Senate approval, 2026-09-10 (letters, ng removed, apostrophe retained):
  https://gov.uz/en/kongeotexnazorat/news/view/217317
Official-quoting media:
- Gazeta.uz, "Law on revised Uzbek alphabet signed on Uzbek Language Day", 2026-10-21 (signature, 28 letters + apostrophe, Saida Mirziyoyeva):
  https://www.gazeta.uz/en/2026/10/21/uzbek-alphabet/
- Gazeta.uz, "Senate approves new version of Uzbek alphabet of 28 letters", 2026-09-10 (ng excluded; spelling rules separate):
  https://www.gazeta.uz/en/2026/09/10/uzb-alphabet/
- UzDaily, "Uzbekistan's New Latin Alphabet to Take Effect in 2027" (effective 2027-04-22, transitional rules, government programme within 2 months):
  https://www.uzdaily.uz/en/uzbekistans-new-latin-alphabet-to-take-effect-in-2027/
- Daryo, 2026-07-07, bill passes Legislative Chamber: https://daryo.uz/en/2026/07/07/uzbekistan-advances-new-28-letter-latin-alphabet-to-senate/
- Daryo, 2026-09-10 (textbooks fully switched by 2031):
  https://daryo.uz/en/2026/09/10/uzbekistan-to-fully-switch-school-textbooks-to-updated-alphabet-by-2031/
- Legal Alliance summary: https://legalalliance.uz/en/news/novyy-uzbekskiy-alfavit-28-bukv-senat
History:
- Kun.uz, 2021-03-16/17 "Uzbek alphabet may change": https://kun.uz/en/news/2021/03/17/uzbek-alphabet-may-change
- Kun.uz, 2023-07-05, Mirziyoyev on completing alphabet work: https://m.kun.uz/en/news/2023/07/05/shavkat-mirziyoyev-we-need-to-complete-the-work-on-improving-our-alphabet
- Gazeta.uz, 2023-12-11, Saida Mirziyoyeva on alphabet: https://gazeta.uz/en/2023/12/11/saida-mirziyoyeva-on-uzbek-alphabet
NOT obtained: the lex.uz text, law number (ZRU-xxx), official publication date. TODO for the owner or a follow-up pass:
search lex.uz for "Lotin yozuvidagi o'zbek alifbosini joriy etish to'g'risida"gi Qonunga o'zgartirishlar.

## 2. The new alphabet: legal status

| Item | Value | Confidence |
|---|---|---|
| Instrument | Law amending the 2020 law on introducing the Latin-based Uzbek alphabet | High (gov.uz, Gazeta) |
| Legislative Chamber | passed 2026-07-07 | High |
| Senate | approved 2026-09-10 | High |
| Signed | 2026-10-21 by President Mirziyoyev | High (Gazeta, UzDaily) |
| Law number | not found | Unknown |
| In force | 2027-04-22 (UzDaily); "six months after official publication" (other outlet). Consistent if published ~2026-10-22 | Medium |
| Transition | old documents, currency, securities stay valid; signs and textbooks replaced as they wear out; school textbooks by 2031; Cabinet programme within 2 months | Medium |
| Rationale cited | O'/G' typing takes up to 6 keystrokes, 10+ variants in use | Medium |

Competing proposals (all superseded by the 2026 law):
| Date | Proposal | Status |
|---|---|---|
| 1993 | Latin with ş ç ŏ/õ ğ (Turkish-like) | replaced in 1995 |
| 1995 | Current Latin: oʻ gʻ sh ch ng, 26 letters + 3 digraphs (29 units in some counts) | in force until 2027-04-22 |
| 2019 | Tashkent State Univ. working group draft: ō, ş, ç, ğ and "ng" kept (diacritics) | not adopted |
| 2021-03 | Draft with 29 letters incl. "ng" as a unit (Kun.uz) | not adopted |
| 2021-11 | Linguists: oʻ, gʻ, sh, ch, ng each one character | not adopted |
| 2023-07 | Mirziyoyev orders alphabet improvement and draft law | led to the 2026 law |
| 2026 | Ö Ğ Ş Ç, ng not a letter, 28 + apostrophe | ADOPTED, signed 2026-10-21 |

## 3. New alphabet table (letters that differ; all others identical)

| Cyrillic | Current Latin | NEW Latin | Confidence |
|---|---|---|---|
| Ў ў | Oʻ oʻ (U+02BB) | Ö ö | High (gov.uz) |
| Ғ ғ | Gʻ gʻ | Ğ ğ | High |
| Ш ш | Sh sh | Ş ş (U+015F cedilla, not U+0219) | High on letter; code point per alifbo |
| Ч ч | Ch ch | Ç ç | High |
| Нг нг | ng | "ng" (not a separate letter; spelling to be set in the spelling rules) | Medium-low, UNCONFIRMED |
| Ъ ъ (tutuq) | ʼ (U+02BC) | ʼ / ' apostrophe retained | High that it is retained; exact code point UNCONFIRMED |
| Щ щ | shch (Russian loans) | şç (alifbo's choice) | Low |
| Ё Ю Я | yo yu ya | yo yu ya | unchanged (not mentioned as changed) |
| Ц ц | s / ts | s / ts | unchanged |
| Е е | e / ye | e / ye | unchanged |

Others: A B D E F G H I J K L M N O P Q R S T U V X Y Z unchanged. Interpretation: 26 old-Latin letters + Ö Ğ Ş Ç - (O', G' counted
as letters) ... counting is the press's; do not rely on it. Important consequences: in the new Latin, "sh" and "ch" sequences
(e.g. "s"+"h" across a morpheme boundary, "Isʼhoq") are no longer ambiguous visually, so the sʼh problem exists only for
old-Latin -> Cyrillic.
Flag: no official table showing capitals handling (İ/I, Turkish dotted-i) was found; new Latin uses plain I i (UNCONFIRMED).

## 4. Rules for conversion

### 4.1 Cyrillic -> Latin (current Latin; new Latin = same then map digraphs to Ö Ğ Ş Ç)
Base: а a, б b, в v, г g, д d, ж j, з z, и i, й y, к k, л l, м m, н n, о o, п p, р r, с s, т t, у u, ф f, х x, ҳ h, қ q,
ў oʻ, ғ gʻ, ш sh, ч ch, э e, ю yu, я ya, ё yo, ъ ʼ, ь (dropped), ц ts/s, щ shch, ы i (loans), ҳ h, нг ng. [K]
- Е: "ye" at word start, after a vowel, and (per alifbo) after ъ/ь; otherwise "e". Examples: ер yer, мева meva, давлат davlat, соэ... [K]
  Э is used for "e" at word start in loans (эълон eʼlon, эшик eshik). Е inside Russian loans after vowel: поэт poyet is wrong,
  keep "poet": exception list.
- Ц: official rule: "s" at the beginning of a word and after a consonant ("sirk" for цирк, "sex"), "ts" after a vowel
  (station = "stansiya" uses с; "konstitutsiya", "lotsman"). Practical rule used by alifbo: s at word start and in "цц" second letter,
  else "ts".
- Ъ -> ʼ (U+02BC) between letters (маъно maʼno, шаъни shaʼni). Ь dropped (дольше ...). Word-final ъ rare (e.g. "жўъ").
- Ё Ю Я -> yo yu ya in all positions; after consonants in Russian loans they are mostly the same (тюль tyul). Official rules
  have "ya/yu/yo" after a consonant as plain "ya/yu/yo". Warn when ambiguous.
- Capital digraphs: title case "Sh Ch Oʻ Gʻ" ("Shahar"). All-caps context: "SHAHAR", "OʻZBEKISTON" (so the digraph second letter follows
  the neighbours' case). Single capital before lower-case: "Sh". Rule: if the next/previous alphabetic char is uppercase, use ALL CAPS.
  New Latin: Ş Ç Ö Ğ are single letters, no problem. (alifbo does NOT address this: needs own tests.)
- Apostrophes in Latin output: oʻ gʻ use U+02BB ʻ; tutuq uses U+02BC ʼ. Input variants to normalise: ' ` ´ ‘ ’ ʻ ʼ ′ and U+2018/2019.
  Rule (alifbo, matches common practice): after o/g -> ʻ; elsewhere -> ʼ.
- Russian loanwords: Cyrillic text in Uzbek writes loans as in Russian; official rules ask to transliterate by phonetics
  (ц->ts/s, щ->shch, ы->i, ь dropped, "ье/ьо" -> "ye/yo" e.g. "семья" -> "semya"). Needs an exception list for
  hard words (e.g. "съезд" sʼyezd; "Россия" Rossiya; "поэзия" poeziya).
- Proper names that originate in Russian keep Russian-based spelling (alifbo "foreign-words.json" idea).

### 4.2 Latin -> Cyrillic
- Greedy tokeniser, longest first: oʻ gʻ sh ch yo yu ya ye ng ts shch -> then single letters. Normalise apostrophes first.
- "ye": at word start or after a vowel -> е, otherwise ye = й+е ("yer" -> ер). Bare "e": word-initial -> э, otherwise е after a consonant; "e" after a vowel -> э (maʼeʼ...).
  Rule of thumb: word-initial e -> э (eʼlon -> эълон), after consonant e -> е (kech -> кеч), after vowel e -> э (poeziya -> поэзия).
- "ts" -> ц only in the known list (loans), otherwise т+с ("otsiz" is rare; "tsement" ->  цемент): needs exception list. In the new Latin "ts" is unaffected.
- "sh" vs "sʼh": old Latin: s+h with tutuq between = с+ҳ (Isʼhoq -> Исҳоқ, "asʼhob"). Without the tutuq the ambiguity is real:
  "maslahat" (маслаҳат, NOT маслахат/маслашат?)- here "s"+"l" no issue; the problem words are "mash'al/mas'hab/is'hoq/as'hob/ba's hat".
  Known patterns: Arabic-origin "sʼh" words (Isʼhoq, aslʼha ...), "t'h"/"k'h"? ("tʼh" rare). Resolution: (1) tutuq-guard rule;
  (2) exception dictionary of words where unmarked "sh" must be с+ҳ (e.g. "ishq"? no - this is ш; real list: mashhur -> машҳур (!),
  "mashhad", "isHoq", "tashhis", "shahar"...). Key: "mashhur" -> машҳур, "ashhedu", "tashhis" -> ташхис; "Ishhoq" -> Исҳоқ.
- "ch" vs "c"+"h": no real ambiguity ("c" does not exist in Uzbek Latin). "ng": always нг (never н+г split): ng -> нг; the
  exception is the n+g boundary in compounds (e.g. "singil", "ongsiz?"; "tungi" fine). Use rule: ng -> нг unless exception ("bangi"?) - a
  short exception list (~dozens) is enough. New Latin: ng -> нг (same).
- Case: "Sh", "SH", "sh" -> Ш/Ш/ш; "OʻZBEKISTON" -> ЎЗБЕКИСТОН. Title-case digraph detection needs lookahead.
- Plain ' or ` after o/g -> ў/ғ; elsewhere -> ъ. Ambiguous: "mavʼzu" -> мавзу? (мавзу uses no ъ). Also "ma'no" -> маъно. A stray
  ʻ without o/g -> warning.
- Ş Ç Ö Ğ -> Ш Ч Ў Ғ directly, no ambiguity; "sh"-in-new-Latin text means с+ҳ (new Latin spells ш as Ş), so the sʼh problem vanishes.
- Not representable round-trip: ь, ё vs йо, щ vs шч, ц vs тс, ы. Round-trip tests must use a normalising comparison.

(Caution: examples in 4.2 for sʼh/ng were drafted quickly and several example words are guesses; they are marked for
verification by a Uzbek speaker before they go into the exception file. Confirm every entry from a dictionary.)

## 5. Open-source comparison

| Project | URL | Licence | Stars / activity | Lang | Directions | Notes | New Latin |
|---|---|---|---|---|---|---|---|
| alifbo | https://github.com/azakapro/alifbo ; npm `alifbo` ; PyPI `alifbo` 0.6.0 (2026-09-16) | MIT | 8 stars, 62 commits, last commit date not shown (very recent, v0.5.0 -> 0.6.0) | TypeScript (+ Python port, 0 deps) | Cyr<->Old Latin<->New Latin, all 6, CLI, alphabet detection | positional е/ye, ц rule, ъ->ʼ, ь dropped, apostrophe normalisation, sʼh protection with SMALL seed exceptions (size unstated), foreign-words JSON, custom exceptions, protected spans, warnings; 13,000+ fixtures; capital digraphs not addressed; ng configurable | Yes (Ö Ğ Ş Ç, ç/ş cedilla folding) |
| UzTransliterator | https://github.com/elmurod1202/UzTransliterator ; PyPI UzTransliterator 0.0.34 | MIT | 0 stars, 14 commits shown | Python (scikit-learn, rules + statistical) | Cyr/Latin/NewLatin | academic (paper "A machine transliteration tool between Uzbek alphabets"); its "New Latin" is the 2019/2021-era scheme, check letters before reuse; ML dependency heavy for Node | Partly (older proposal; verify) |
| lycy | https://www.npmjs.com/package/lycy (repo not found) | UNKNOWN (not shown) | 1.0.0, single maintainer | JS | Latin<->Cyrillic | special rules for 500+ words (loans) | No |
| kiril-to-uzbek-latin | https://classic.yarnpkg.com/en/package/kiril-to-uzbek-latin | unknown | old | JS | Cyr->Latin only | minimal | No |
| fitrat | https://pypi.org/project/fitrat | unknown (not checked) | - | Python | NLP lib with transliterators | broad toolkit | unknown |
| uzbek-mcp / uztranslit (PHP) | https://packagist.org/packages/shaxzodbek-uzb/uzbek-mcp | MIT (mcp) | - | PHP | Lat<->Cyr | not for our stack | No |

Not checked individually: other small npm packages (e.g. "uzbek-transliterator", "kiril2latin" names from the brief) and any GPL/AGPL ones.
Licence of lycy: unknown, therefore not usable until verified.

Ranking for TypeScript/Node:
1. alifbo (MIT, native TS, only one with the 2026 alphabet and tests).
2. lycy (only if licence turns out MIT/ISC; use its 500-word loan list as a source for OUR exception file, after licence check).
3. UzTransliterator as a reference/test oracle only (Python, MIT) - port the ideas, not the code.

## 6. Recommendation

1. Adopt `alifbo` as the engine (npm, pin an exact version; vendoring the MIT licence text in our third-party notices).
   Reasons: only mature option with all six directions and new Latin; zero deps; fixtures to reuse.
2. Wrap it in `lib/translit` of our own: input normalisation (apostrophes, U+0219->U+015F, NFC), script detection, our own capital-digraph
   handling (SH / Sh / sh in ALL-CAPS runs), a mixed-script text splitter (leave URLs, numbers, Latin brand names alone), and
   option `ngAsDigraph` fixed to true until the law text says otherwise.
3. Build our own exception dictionary (JSON, data not code): Latin->Cyr for sʼh/ng/ts/e words and Cyr->Latin for Russian loans.
   Size: start ~300 entries (measured from a 1,000-sentence sample of our own generated documents), grow to ~1,000. Unmeasured estimate.
   Source candidates: lycy's list (after licence check), alifbo's seed list, Uzbek orthography dictionary (lex.uz).
4. Differential testing: round-trip on our corpus, compare against alifbo's fixtures and (as oracle) UzTransliterator;
   mutation per rule, per project policy (every parameter must work).
5. Fallback if alifbo is abandoned: its MIT licence allows a fork; the rules above are small enough (~400 lines) to own.
6. UI: label the new Latin "Yangi lotin (2027-yil 22-apreldan)"; keep old Latin as default until the effective date.

## 7. Open questions for the owner

1. Law number and official text: OK to send a follow-up pass to find the lex.uz text (ng wording, apostrophe code point, capital I)?
2. ng: keep "ng" as two letters in new Latin output (alifbo default) until the spelling rules are published?
3. Which apostrophe do we emit for tutuq: U+02BC ʼ (modifier) or plain '? (affects search and Telegram copy-paste.)
4. Default target when the user does not choose: old Latin until 2027-04-22, then new Latin?
5. Should Cyrillic Russian-loan words be kept in Russian-style (поэт, Россия) when converting to Latin, or transliterated phonetically?
6. Who proofreads the exception dictionary (a native Uzbek linguist)? Budget for ~1,000 entries.
7. Does the converter also feed the other tools (documents, slides) as a post-processing option, or is it a standalone page only?
