# W4-D review — frontend P3 (FE-11, FE-13, FE-15, FE-17, UX-10, GameSharePanel, C41 client)

Reviewer: independent, read-only. Branch `worktree-agent-a7ae68583a9f347df` (`556971a..b230608`, base `447c6a4`), compared against `audit/production-readiness` @ `da3c2f5`.

## Verdict: **CHANGES REQUESTED** (2 small required changes; everything else is sound)

## Tests run (from worktree, through heavy2.sh gate)

| Command | Result |
|---|---|
| `tsx --tsconfig tsconfig.viewer.json --test tests/ui/render-storm.test.mts tests/ui/form-draft.test.mts tests/ui/photo-field.test.mts` | 11/11 pass (reveal: 535 frames, 576 SlideCanvas renders, 4 SlideRail renders) |
| `tsx --conditions=react-server --test tests/bundle-split.test.mts tests/edit-reconcile.test.mts tests/ui-strings.test.mts` | 13/13 pass |
| `tsx --tsconfig tsconfig.viewer.json --test tests/viewer/live.test.mts tests/ui/game-share-panel.test.mts tests/ui/template-gallery.test.mts` | 38/38 pass |

No DOM node is compared with `equal`/`deepEqual`. The deepEqual calls compare strings or arrays of strings, and the equal calls compare counts or `null`. I did not rebuild to check the 517→219 kB and 442→217 kB first-load numbers myself. `bundle-split.test.mts` only checks the import graph statically.

## Adversarial checks

1. **Lazy loading (FE-11)**
   - SSG and SEO are unaffected. `app/uz/[slug]/page.tsx` still has `generateStaticParams` and `generateMetadata`. On the server, `ToolWorkspace` renders `LOADING` because `sessionChecked` is false, so the static HTML is the same as before.
   - `/uz/files/[id]` fetches its data on the client, so no SSR markup depends on the lazy viewers. There is no hydration mismatch.
   - Every lazy use has a `Suspense` fallback: `ToolWorkspace`, `ArtifactViewer` and `RunningPanel`. A slow network shows "Yuklanmoqda..." and never a blank form.
   - "ko'rdim = oldim" parity is not broken. The viewer is never captured headlessly: PDF and PPTX are rendered on the server, and `ArtifactViewer` has only one consumer, `ResultView`. The only visible effect is a short loading line before the viewer appears.
   - **Chunk-load failure is not recoverable → R1.**
2. **Memoisation (FE-13)**
   - The `SlideCanvas` `useMemo` deps list every `planSlide` argument.
   - `applyDocOps` is pure and returns new slide objects, so an edit changes the `slide` identity and the canvas re-plans. There is no stale UI.
   - `liveDocOf` is memoised on `live` identity. `mergeLive` keeps that identity only when the server omitted `live`, so a changed tick always produces a new doc.
   - `keepUnchanged` compares whole rows with `JSON.stringify`, which is a deep comparison. Any change to status, progress or preview gives a new object, and `FilePreview` re-renders. Row order is checked with `keep !== prev[i]`. This is correct.
3. **FE-15 reconcile**
   - Nothing is ever re-sent, so an AI edit cannot be applied twice.
   - Only 502, 504, status 0 and a 5xx without text count as uncertain. 409, 429, 402 and 5xx responses with server text are thrown unchanged.
   - Success is claimed only when `docVersion > base`. If the server really failed, the version does not move, and the user gets `UNCONFIRMED_TEXT` after at most 36 × 5 s. There is no false success, apart from the concurrent-bump case in N1.
   - The target branch's lean responses (W4-E) still return `docVersion`.
   - The template-upload reconcile matches the server's name sanitising exactly.
4. **FE-17 drafts**
   - The file text is dropped only when `fileName` is set, and the file name is restored in a notice asking the user to re-attach the file.
   - The size check runs on the exact PUT body `{"data":…}`. `keepalive` is used only when that body is ≤ 60 000 bytes, below the 64 KiB limit. A larger body falls back to a normal request, and a body over 190 000 bytes is not sent and shows a notice.
   - **One path loses typed text → R2.**
5. **Duplicated extract limits:** acceptable. The values are the same, the duplication is small, and `bundle-split.test.mts` fails if they drift apart.
6. **GameSharePanel:** it uses the server's `total` and `nextCursor`, which the base branch already returns, and de-duplicates rows by id. **C41 client:** only a 404 or 410 clears the id. A 401, a 200 or a network error keeps it and shows a neutral warning.

## Required changes

**R1. Recover from chunk-load failure (a regression introduced by FE-11).**
- The composers and viewers are now `React.lazy` chunks that load after navigation, so Next's `handleHardNavError` no longer applies: `__pendingUrl` has already been cleared.
- After a deploy, a tab left open (the app ships a PWA manifest) asks for a chunk hash that no longer exists. The nginx `slaydx_static` cache only keeps chunks that someone already requested, so rare composers such as infographic are missing.
- The error reaches `app/error.tsx`. Its "Qayta urinish" calls `reset()`, but `React.lazy` has cached the rejected promise, so the same error is thrown again every time. The user is stuck until they reload by hand, and this happens on every tool and document open after each deploy.
- **Fix:** in `app/error.tsx`, and in `global-error.tsx` too, detect a chunk error: `error.name === "ChunkLoadError"`, or the message matches `/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/`. When it matches, call `window.location.reload()` once, guarded by a `sessionStorage` flag wrapped in try/catch. Otherwise make the button do a full reload.
- **Test:** add a test that locks this behaviour.

**R2. The MediaComposer (podcast) draft drops text the user typed.**
- Repro: in "file" mode, attach a file. Switch to "text" mode, where the textarea shows the same `sourceText`, and edit or replace the text. `fileName` is still set, so `draftPayload` strips `sourceText`.
- On restore, `fileName` is cleared and the textarea comes back empty. The user's text is lost, which breaks "the draft restores everything the user typed". The old code sent it.
- **Fix, either of these:**
  - keep `sourceText` when the form's mode is `text`;
  - or clear `fileName` in MediaComposer when the user switches to text mode, or edits the text there.
- **Test:** add a form-draft test for this case.

## Nits (non-blocking)

- **N1.** Any other `doc_version` bump during the ≤3-minute reconcile window counts as success. Examples: another tab's edit, or the retention job in `lib/server/retention.ts:103`. The result is adopted, so the UI still shows the real server state. It is worth a comment in the code.
- **N2.** The `reconcile` loop keeps polling after `ResultView` unmounts, for up to 36 GETs. It could take an `AbortSignal`. During that wait the spinner also has no label; "Natija tekshirilmoqda…" would help.
- **N3.** There are two separate `lazy(() => import("../viewers/SlideViewer"))` wrappers, in `ResultView` and `ArtifactViewer`. When a live deck finishes, the second wrapper suspends for one frame and shows "Yuklanmoqda..." in place of the canvas. Export one shared lazy component to remove the flash.
- **N4.** `uploadConfirmed` ignores an asset that was already in `known`. If the user re-uploads the same PPTX (same hash, so the server upserts), the upload succeeds but the UI still says it could not be confirmed. If `list` hasn't loaded yet, `known` is empty and any older template with the same name is taken as the result.
- **N5.** The professions DB loads after mount. A query typed before it arrives shows no suggestions until the next keystroke. This is acceptable, but a test should cover it.
- **N6.** When the page is unloading and the body is over 60 KB, the fallback request is usually cancelled by the browser. `failed` gets set on a page that is already gone. This is harmless and could be documented.

## Merge-conflict notes

- `git merge-tree` against `audit/production-readiness` @ `da3c2f5`, which already has W4-C, W4-E and W4-F merged, is **clean: no textual conflicts**.
- I found no semantic clashes with the W4-E changes:
  - lean edit responses still carry `docVersion`, which FE-15 relies on;
  - the template upsert now refreshes `created_at` (see N4);
  - the results cursor is parsed with `parseIsoInstant` and accepts the ISO string the client sends;
  - photo purge now respects drafts, so C41 is defence in depth.
- After merging, re-run `tests/bundle-split.test.mts`, `tests/edit-reconcile.test.mts` and `tests/edit-response-lean.test.mts` (the last one needs the DB).
