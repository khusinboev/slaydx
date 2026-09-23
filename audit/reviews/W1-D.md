# W1-D review: C04 + C06 (user-file parsing freeze)

Branch `worktree-agent-af4480ea014970403` (`65fbd58..6536324`), diffed three-dot against `audit/production-readiness`.

## Verdict: **CHANGES REQUESTED**

Most of the package is solid. The linear scanners give the same output as the old regexes. The streamed inflate budget really stops mid-entry. The PDF work (page cap, linear `toLines`/`toBlocks`/`sharedColumns`) is correct, and the worker pool is well built. Two gaps remain on the paths this package set out to protect:

1. A template-upload freeze in the web process through `render-pptx-template.ts` (measured).
2. A way around the pre-allocation entry-count check (measured).

The in-process fallback also needs to be louder.

## What I verified

- **Tests** (gate, from worktree root): `parse-linear`, `zip-budget`, `pdf-limits`, `parse-pool`, `upload-body` + `extract`, `translate-plain`, `translate-pdf`, `translate-docx`, `pptx-template` → **72/72 pass**, 5.1 s.
- **Same output as before.** I ran my own differential fuzz, loading the old files from `audit/production-readiness` next to the new ones. It covered `textToSegments/applyText`, `mdToSegments/applyMd` (with token-mangling maps, which exercise `replacePairs`), `csvToSegments/applyCsv`, `tidy`, `fromDocxXml/fromPptxXml/fromXlsxShared`, and the template `placeholdersOf/themeColors/themeFonts/xfrmBox/relTarget/layoutKind`. Runs: 20 000 cases at length ≤ 40 plus 8 000 cases at length ≤ 150, on adversarial alphabets. Result: **0 diffs**.
- **Semantics by reading the code:**
  - `readPdfText` produces exactly `unpdf.extractText({mergePages:true})`: same `getPageText` and same `normalizeMergedText` regexes (`node_modules/unpdf/dist/index.mjs:393-402`).
  - The `toLines` buckets match `find`, because at most one line fits in each `LINE_TOL` bucket and `line.y` never changes.
  - The `toBlocks` hyphen join and the `rowOf`/`sharedColumns` changes are equivalent.
  - The one intended behaviour change is `MAX_TABLE_ROWS = 400` table rows per page (harmless).
- **Linearity of what remains** in owned files: `MD_PREFIX`, `TABLE_SEP`, `FENCE`, `decode`, `/[^\S\n]+/`, `XFRM_REST` (sticky) and `attr()` are anchored or have a single start each. I found nothing quadratic left in the owned files.
- **Zip budget** (`readZipText`): the counter runs per `internalStream` chunk and calls `pause()` at the limit. The extra overshoot is at most one 16 KB compressed block's inflate. The declared size is used only for early rejection. `openOoxml`, `extract-text` and `pptx-template` all go through it. The 40 MB / 100 layouts limits are sane.
- **Pool:**
  - `terminate()` runs on every settle path (message, error, exit, timeout). The `error` listener is always attached. The timer is cleared.
  - The 2 running + 8 queued bound returns 503 when full.
  - OOM → `ERR_WORKER_OUT_OF_MEMORY` → clean 422. Messages are in Uzbek.
- **Body cap:** `readUploadForm` counts chunks and cancels the stream past the cap. The test proves at most cap + 1 chunk is pulled.
- **Fallback cost** (in-process, measured):
  - 300-page textbook PDF: 0.87 s (source path) / 0.53 s (extract), one uninterrupted block.
  - One dense page, 13 MB: ≈ 2.0 s.
  - So with the page cap and linear scanners, the fallback still blocks for seconds, not minutes. Unknown pdf.js worst cases stay unbounded without the thread.

## Required changes

### R1. The template path still freezes the web event loop (SECB-01 class, same upload)
`uploadTemplate` → `rasterizeTemplate` (`lib/server/template-upload.ts:87`, runs in **web**, outside the pool) → `renderLayoutSheet` → `assemble` applies backtracking regexes to user XML that `parsePptxTemplate` has only budget-checked (up to 40 MB):

- `lib/generation/render-pptx-template.ts:152` `/<Override\b[^>]*PartName="\/ppt\/(slides|notesSlides)\/[^"]*"[^>]*\/>/g` on `[Content_Types].xml`
- `:157` `new RegExp(`<Relationship\\b[^>]*Type="${REL_SLIDE}"[^>]*/>`, "g")` on `presentation.xml.rels`
- `:159` `/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/` on `presentation.xml` (many opening tags without a close)

**Measured** (valid template, `[Content_Types].xml = "<Types>" + "<Override ".repeat(k) + "</Types>"`, passes `parsePptxTemplate`): 50 KB → 195 ms, 100 KB → 646 ms, **200 KB → 2.5 s** (×4 per doubling). 1 MB ≈ 1 min and 4 MB ≈ 16 min, all within the 40 MB budget. The same `assemble` also runs in web through `lib/server/edit-adapters.ts:91` (`renderPptxWithTemplate` on viewer edits of custom-template decks), and in the job worker.

Fix (both parts):
- (a) Run the layout-sheet build in the pool. Add a `{ kind: "layout-sheet", bytes, profile }` task in `parse-tasks.ts` that returns `{ bytes, pages }`, and call it from `rasterizeTemplate`. Both files are owned by W1-D.
- (b) Make the three `assemble` regexes linear. `render-pptx-template.ts` is outside W1-D's file list, so the orchestrator must assign it or extend ownership. Example:

```ts
// [^>]* cannot cross '>', so scan tag by tag instead of backtracking:
function dropTags(xml: string, open: string, keep: (tag: string) => boolean): string {
  let out = "", from = 0;
  for (let o = xml.indexOf(open); o >= 0; ) {
    const after = o + open.length;
    if (after < xml.length && /\w/.test(xml[after])) { o = xml.indexOf(open, o + 1); continue; }
    const gt = xml.indexOf(">", after);
    if (gt < 0) break;
    const tag = xml.slice(o, gt + 1);
    if (tag.endsWith("/>") && !keep(tag)) { out += xml.slice(from, o); from = gt + 1; }
    o = xml.indexOf(open, gt + 1);
  }
  return out + xml.slice(from);
}
ct = dropTags(ct, "<Override", (t) => !/PartName="\/ppt\/(slides|notesSlides)\//.test(t));
presRels = dropTags(presRels, "<Relationship", (t) => !t.includes(`Type="${REL_SLIDE}"`));
// sldIdLst: first open, then indexOf of the close after it (one start only)
```

Differential-test the new version against the old regexes, as was done for `pptx-template.ts`. Add a timing case to `parse-linear.test.mts` using the payload above.

### R2. The entry-count pre-check fails open, so JSZip allocates every entry before the post-check
`lib/generation/translate/xml-scan.ts:252-275` `countZipEntries` differs from JSZip in three ways:

- It searches for the EOCD only in the last 64 KB + 22 bytes, and `if (eocd < 0) return 0` (`:261`) lets the file through. JSZip's `lastIndexOfSignature` searches the **whole** buffer.
- It ignores ZIP64. If `cdSize`/`cdOffset` is `0xFFFFFFFF`, or any 16-bit field is `0xFFFF` (only `declared` is checked, at `:265`), JSZip switches to the zip64 record and walks the real directory. Meanwhile `countZipEntries` walks from a negative `p` and returns `declared`.
- **Measured:** 60 000 empty stored entries followed by 70 KB of zero padding gives `countZipEntries` = 0. `loadZipCapped` then spends 337 ms and 49 MB of heap before the post-load check rejects. A 20 MB upload holds about 230 k entries, so roughly 1.3 s and 190 MB, which is fully blocking in the fallback. The regression test only covers an understated EOCD count.

Fix: fail closed, and mirror JSZip's EOCD choice:

```ts
let eocd = -1;
for (let i = bytes.length - 4; i >= 0; i--) { if (/* PK\x05\x06 */) { eocd = i; break; } } // same as JSZip lastIndexOfSignature
if (eocd < 0 || eocd + 22 > bytes.length) return 0;          // JSZip rejects this file itself
const zip64 = [4, 6, 8, 10].some((o) => dv.getUint16(eocd + o, true) === 0xffff)
  || dv.getUint32(eocd + 12, true) === 0xffffffff || dv.getUint32(eocd + 16, true) === 0xffffffff;
if (zip64) return limit + 1;   // or parse the zip64 EOCD (locator at eocd-20) and walk from its 64-bit offset
```

Rejecting zip64 is acceptable at ≤ 20 MB. If owner data shows real OOXML files written with forced zip64, parse the zip64 record instead. Add regression cases for trailing padding (> 64 KB) and a zip64 marker.

### R3. The in-process fallback must be loud and bounded
The Dockerfile bundling of `parse-worker.mjs` is not on `audit/production-readiness` or on any worktree branch yet. If it doesn't land, prod silently runs every parse in-process. Today that produces a single `console.warn` at first use (`lib/server/parse-pool.ts:180`), and `run()` at `:146` has no concurrency limit at all.

- Log at `console.error` with a stable tag (e.g. `[parse] FALLBACK in-process`). Also log once per N fallback runs, or expose the fallback in `/api/health`, so it is visible after the first log line has scrolled away.
- In fallback mode, keep the same `running`/`queue` accounting with `maxRunning = 1`. N concurrent uploads should not stack N parses back-to-back on the event loop.
- Merge gate: W1-D counts as closing C04/C06 only once the Dockerfile/bundle package lands. Record this in `03-progress.md`. Suggestion: a deploy smoke test that asserts `resolveParseWorkerEntry()` is non-null inside the built image.

## Tracking (not blocking this package)
- **SECB-05 is only partly closed.** `lib/server/logo.ts:88`, `photo.ts:140`, `slide-image.ts:54` and `resume-photo-commit.ts:67` still check only `Content-Length` before calling `req.formData()`. All are outside W1-D ownership. `readUploadForm` is a drop-in fix. Keep SECB-05 open until they are converted.
- W1-C review R4 handed W1-D the BEA-02 leftovers: `cleanText`/`toJsonb` for `source_uploads.text/name` and `template-upload.ts` profile. They are not in this branch (it predates the W1-C merge). Do them after rebasing, or re-assign them.
- `render-pptx-template.ts` reads `[Content_Types].xml`, rels and `presentation.xml` with an uncapped `async("string")`. These reads are safe for templates uploaded after this fix, because `parsePptxTemplate` now budgets those same entries and `generateAsync` reuses the compressed DEFLATE bytes. Templates stored **before** the fix were never budget-checked.

## Nits (optional)
- `runInThread`: `postMessage({ task }, [task.bytes.buffer])` after a copy avoids a second 20 MB structured clone.
- `resourceLimits` sets only `maxOldGenerationSizeMb`. Consider `maxYoungGenerationSizeMb` and `stackSizeMb` as well. ArrayBuffer (external) memory is still not capped.
- Pool fairness: 2 threads are shared by all users. One user with crafted 15 s files, within the per-user rate limits, can keep a thread busy and push others into 503s. A per-user in-flight cap of 1 would prevent that.
- Queued tasks keep running after the client disconnects. Consider checking `req.signal.aborted` before `start()`.
- The `pdfToBlocks` page-limit `if` at `pdf.ts:365` is not indented inside the `try`.

---

## Re-review (commits `0169b3a..f11f551`): **APPROVE**

**Tests** (heavy2 gate, worktree root): `parse-linear`, `zip-budget`, `pdf-limits`, `parse-pool`, `upload-body`, `extract`, `translate-plain`, `pptx-template`, `render-pptx-template`, `template-upload`, `translate-pptx`. **83/83 pass.**

### R1: fixed
- **Linear now.** `assemble` uses `removeTags` and `replaceFirstBlock`. When a match fails, the scan resumes from `g1`. That is safe because every opening tag inside `(o, g1)` has a subset of the same candidates. The `.` in `REL_SLIDE` still matches any character, and that case is handled (`dotAny`).
- **Same output as the old regexes.** I ran my own differential fuzz against the old regexes on adversarial alphabets: `>` in place of `.`, `\n` in the URI, nested and unclosed `<Override`, `<Relationship` and `<p:sldIdLst>`. Two runs of 50 000 cases at length ≤ 25 and 20 000 at length ≤ 80 gave **0 diffs**.
- **Timing, re-measured** (was 200 KB → 2.5 s, ×4 per doubling):
  - `[Content_Types].xml` with `<Override ` × k: 200 KB → 32 ms, 1 MB → 45 ms, 4 MB → 111 ms.
  - `presentation.xml.rels` with 950 KB of unclosed `<Relationship … Type="…/slide"`: 28 ms.
  - 200 KB of `<p:sldIdLst>` × n: 5 ms.
- **Size limit applies at render time too.** `assemble` reads its XML under the 40 MB `TEMPLATE_MAX_XML` budget. Both render entry points go through `loadZipCapped`, so templates stored before the fix are covered as well.
- **Layout sheet runs in the pool.** `rasterizeTemplate` now builds the sheet through the `layout-sheet` task. If it fails, it falls back to no background, which is harmless. The worker and in-process results match in the test.

### R2: fixed
- **Same EOCD search as JSZip.** `zipDirectoryInfo` searches backwards over the whole buffer, as JSZip does. It gives up when the central directory would start at a negative offset, which JSZip rejects anyway. It walks the directory from the same place JSZip does.
- **ZIP64 is rejected.** Any field set to `0xFFFF` or `0xFFFFFFFF` triggers the rejection.
- **Re-ran my PoC.** 60k entries followed by 70 KB of padding now report 10 001 entries (the count stops just past the 10 000 limit) and are rejected in 1 ms, with no heap growth. Before the fix this took 337 ms and 49 MB. A zip with a zip64 marker is rejected in 0 ms.
- **New tests** assert that `JSZip.loadAsync` is called 0 times for both cases.

### R3: fixed
- **Bounded.** The in-process fallback now goes through the same 2 running + 8 queued limit, and returns 503 beyond it.
- **Logged.** It logs a `[parse] FALLBACK in-process` warning with a running count, at most once per minute. The test covers both.
- **Merge gate stands.** C04/C06 only count as closed in prod once the Dockerfile/esbuild bundle of `parse-worker.mjs` lands. Keep this recorded in `03-progress.md`.

### Nits (optional, non-blocking)
- The fallback line could use `console.error` so log-level alerting catches it. Two in-process parses running "concurrently" still share one event loop. `maxRunning = 1` in fallback mode would be slightly more honest, but the effect is the same either way.
- Carried over from the first review, still open: postMessage transfer, `maxYoungGenerationSizeMb`, a per-user in-flight cap, and skipping queued tasks for aborted requests. SECB-05 leftovers are assigned to W2-C. The W1-C R4 BEA-02 handoff (`cleanText`/`toJsonb` in `source-upload`/`template-upload`) is still not in this branch, so do it after rebasing onto the W1-C merge.
