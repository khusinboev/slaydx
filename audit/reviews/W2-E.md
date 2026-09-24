# Review — W2-E (frontend: polling, edit save, 429/402/PDF UX, list paging, retention UI)

- **Reviewer:** independent, read-only
- **Branch:** `worktree-agent-a00bb74a74219fe3f` (`9664c0f`, `72a9641`, `f56ca68`)
- **Compared with:** `git diff audit/production-readiness...worktree-agent-a00bb74a74219fe3f`. Contracts were checked against the merged W2-B server on `audit/production-readiness`, not against the stale copy in the worktree.
- **Date:** 2026-09-24

## Verdict: **CHANGES REQUESTED** (2 small, local changes)

The work is solid. Polling can no longer give up without telling the user, and it cannot hammer the server either. The chunked save never double-applies an edit. The contract fields match the merged server exactly. Two gaps remain, both on the path where a response is lost or slow on a weak mobile link, which is the case this package exists to fix:

1. After a save response is lost, the UI tells the user their changes were not applied when they were.
2. The new download timeout also covers the body transfer, so large files can fail on slow connections.

**Tests.** All four files were run from the worktree root through `heavy2.sh -m 3G -t 900`, one file at a time:

| File | Pass | Fail |
|---|---|---|
| `api-client-poll` (react-server) | 21 | 0 |
| `ui/doc-edit-save` | 10 | 0 |
| `ui/result-view-poll` | 7 | 0 |
| `ui/home-files` | 5 | 0 |

No test compares DOM nodes with `equal` or `deepEqual`. The only DOM `equal` is on `.length`.

---

## What was checked and holds

**Polling (C20, UX-07)**
- Retries back off as `min(30 s, 2 s × n)`. If the server sends `Retry-After` (in the header, or as `retryAfterSec` or `retryAfter` in the body), the wait is the larger of that and the backoff, capped at 5 min.
- Only network errors, 0, 408, 425, 429 and 5xx count as transient. 400, 401, 403 and 404 throw.
- Polling returns on any final status (anything other than QUEUED or IN_PROGRESS). After 20 min it keeps going every 30 s and says so once (`slow`). A live IN_PROGRESS deck is not slowed down.
- `waitTurn` sends no request while the tab is hidden. It removes every listener and timer when it settles. The effect cleanup `ctrl.abort()` cancels both the wait and the in-flight fetch through the linked signal. No timer or AbortController leaks were found.
- A 401 during polling calls `onUnauthorized` and then throws. The store sets `loggedIn=false`, and the effect's `!loggedIn` guard stops it from restarting. No loop.
- «Qayta tekshirish» bumps `pollKey`. That aborts the old poll and starts a fresh one, and `loading` does not flash while a document is already on screen.
- Queue position and ETA are shown only when `status === "QUEUED"` and `queuePosition > 0`.

**Edit save (C21)**
- The server lock is strict: `baseVersion !== cur.docVersion` gives 409 (`slide-commit.ts:129`, and the SQL predicate `doc_version = $6`). A chunk that lands but whose response is lost is therefore **never applied twice**. Resending it gets a 409.
- `versionRef` is advanced per chunk from each response's `docVersion`, so chunks go out in strict order.
- Only accepted ops leave the queue (`slice(chunk.length)`).
- On 413 the chunk is halved.
- On network, 429, 5xx, 413 and 401 errors the queue and the undo/redo stacks stay. On 409, 400 and 422 the document is reloaded and the user is told. If the reload also fails, the queue is kept.
- `adoptKeepingQueue` re-applies ops typed during the save on top of the server document.
- `serverEdit`, `onFix` and `onPolish` do not start when the save returned `false`.
- `restore` puts the queue back when the restore fails.

**Contract fidelity**
- List: `{generations, nextCursor}`, default limit 50, opaque cursor.
- Poll: `queuePosition`, `etaSec`, `filesPurgedAt` in the summary, `fileVersion` for `thumb?v=`. `v` must equal the current `fileVersion` for the thumb to be cached, and it does.
- POST 429 `{error, code, retryAfterSec}` plus the `Retry-After` header. PDF 429 and 503 plus `Retry-After`.
- spend.ts: 402 `unpaid`, 429 with `retryAfter`, 503 `disabled`/`global`, 409 `busy`. `busy` no longer triggers a reload.
- `editErrorText` now shows the server's own `error` text.
- `html` is read only as the fallback when there is no `doc` (`ArtifactViewer.tsx:36`, `toLegacyShape`), and nothing reads `values`, so the lean poll response is safe.
- `firstPageCursor()`: the store's `refreshGenerations` calls `listGenerations()` with no cursor, which records `firstCursor` before the zustand `set` re-renders, so the read in render is current.

**Out-of-list edits**
- `EditActions.save` return type: type only.
- `FilePreview`/`DocThumb` passes `fileVersion` through: correct.
- `applyRef` only keeps the new `adoptKeepingQueue` (and so `save`) stable across renders. `push`, `run`, `undo` and `redo` still take `apply` directly, as before, so resume editing behaves the same.

**Text:** all Uzbek. No English leaks were found.

---

## Required changes

### 1. A lost save response leads to a false «qo'llanmadi» and dropped edits

`useDocEdit.save` / `settleFailure`. The sequence:

1. The PATCH for chunk k commits on the server, but the response is lost: the 60 s client timeout fires, or the mobile link drops after the commit. The result is `ApiError(0)`.
2. The queue is kept and `versionRef` is stale. So far this is correct.
3. The user presses «Saqlash» again. The same chunk goes out with the old `baseVersion` and gets 409 `version`.
4. The document is reloaded, **the whole queue is dropped**, and the user sees:
   > «Hujjat boshqa joyda o'zgardi — eng yangi holat yuklandi, tahrirni qaytadan kiriting. Saqlanmagan N ta o'zgarish qo'llanmadi.»

The damage depends on the queue size:
- **≤ 50 ops (the common case):** every edit is in fact saved, but the user is told to type it again. Doing so duplicates the edits, for example an inserted paragraph appears twice.
- **> 50 ops:** the unsent tail chunks are silently discarded. The count N is also wrong, because it includes ops that did land.

**Minimum fix:**
- Remember that the last save attempt ended with a status-0 error (or a timeout).
- When the next save then gets 409 `version`, do not claim the changes were not applied. Say instead that some may already be saved and ask the user to check the reloaded document before re-entering anything. For example: «Oldingi saqlash javobi kelmadi — o'zgarishlarning bir qismi saqlangan bo'lishi mumkin. Hujjatni tekshirib, keyin kerakligini qayta kiriting.»
- Add a `doc-edit-save` test that reproduces the lost response: the server applies the chunk, then the client throws a timeout, then Save gets 409.

**Better fix (optional):** the 409 body carries the server's `docVersion`. If it equals `uncertainBase + 1`, and the reloaded doc matches `apply(baseDoc, chunk)`, treat that chunk as accepted, drop only it, and re-apply the remaining queue with `adoptKeepingQueue`. Nothing is then lost.

### 2. The download timeout covers the body transfer and can break large files on slow links

`downloadGeneration` keeps its 120 s timeout (180 s for PDF) running through `await res.blob()`. Before this change there was no limit at all.

A slide deck with images can be around 10–15 MB. At about 1 Mbit/s on mobile, that transfer alone takes 80–120 s, so a download that is progressing normally is aborted with «Server javob bermadi (vaqt tugadi)». That is a regression for exactly the users this audit targets.

**Fix:** let the timeout guard only until the response headers arrive (time to first byte), then call `link.done()` before reading the blob. Alternatively, scale the body timeout by `content-length`, or make it much longer. The fetch still needs a way to be cancelled, but not a deadline that a legitimately slow transfer can hit.

---

## Optional nits

1. **No jitter in the poll retry backoff** (`2 s × n`). After a deploy returns 502, every open result tab retries on the same schedule. Hidden tabs are paused and the maximum interval is 30 s, so the load stays bounded, but ±20% jitter would spread it for free.
2. **`waitTurn` ends early** on the `online` event or when the tab becomes visible, even during a server `Retry-After` wait (up to 5 min). A user switching tabs can therefore skip the server's back-off. Consider honouring a minimum wait when the wait came from `Retry-After`.
3. **`UNSAVED_FIRST` can be wrong** in `ResultView.onFix` and `onPolish`. After a 409-rejected save the queue has already been reloaded and dropped (`pending === 0`), yet the message still says «Saqlash ni bosing», and that button now does nothing. Consider showing the text only while `editState.pending > 0` after the failed save.
4. **An item can disappear from HomeFiles.** Suppose the user has loaded older pages and a new generation arrives while HomeFiles stays mounted. The next store refresh returns the newest 50, so the former 50th item falls off page one. It sits before the older-page cursor, so it is in neither list and vanishes until reload. Rare. A possible fix: when `older` is non-empty, keep ids that dropped off the store list.
5. **A single op larger than the body limit can never be saved.** A 413 with `chunk.length === 1` is treated as transient, so «Saqlash» retries forever. A specific message (the op is too large, shorten or discard it) would help.
6. **`180 kun` is hard-coded** in the purged-file text. `env.retention.bonusDays` is configurable, so the text can drift from the real setting.
7. **Guard against an empty chunk.** If the queue head ever shrinks during a save (today only `discard` could do this, and it is disabled while saving), the loop would send `ops: []`. `if (!chunk.length) break;` would make that impossible.
8. **Mixed apostrophes** (`'` and `‘`) in new strings, for example «bo‘lmadi» next to «bo'lmadi». This is cosmetic, and the codebase already mixes them.

---

## Re-review — commit `7d9b967` (2026-09-24)

### Verdict: **CHANGES REQUESTED** (1 new required change, R3; R1 and R2 are resolved)

**Tests.** All four files were re-run from the worktree root through `heavy2.sh -m 3G -t 900`, one file at a time:

| File | Pass | Fail |
|---|---|---|
| `api-client-poll` (react-server) | 23 | 0 |
| `ui/doc-edit-save` | 14 | 0 |
| `ui/result-view-poll` | 7 | 0 |
| `ui/home-files` | 6 | 0 |

The new tests cover a lost response with ≤50 ops, >50 ops, and a lost response followed by an edit elsewhere.

### R1: resolved

The fix works like this:
- When a chunk's response is lost (network error, 0, 5xx or a non-ApiError), the chunk is recorded as uncertain in `uncertainRef = {base, count, baseDoc}`.
- `base` is still the pre-chunk version, because `versionRef` only moves forward on success.
- `baseDoc` is read after `adoptKeepingQueue(last)`, so it matches `base` even when earlier chunks of the same save succeeded.
- The next save's first 409 `version` runs `reconcileLost`.

**Can the "landed" check be a false positive?**

It declares "landed" only when both hold:
1. `fresh.docVersion === base + 1`, and
2. `sameJson(apply(baseDoc, head), fresh.doc)`.

A false positive would need a different writer to make exactly one commit that produces a document equal to what our chunk would produce. In that case the content the user wanted is already on the server, so dropping `head` loses nothing.

If the server normalizes differently, or the client's `apply` is not deterministic, `sameJson` fails. That falls to "unknown", the safe side, and it cannot double-apply.

**Other paths:**
- **"unknown":** drops only `head`, which cannot safely be resent because it may have landed. It keeps the unsent tail, clears the stacks and tells the user honestly. «Qaytadan kiriting» is gone. Acceptable.
- **"landed":** `adoptKeepingQueue(fresh)` moves `versionRef` to the new version, then `continue` sends the tail. Correct.
- **Snapshot:** `total -= removed` keeps the snapshot consistent. `discard` and `restore` clear `uncertainRef`. The empty-chunk guard is present.

### R2: resolved

`link.done()` now runs as soon as headers arrive. `res.blob()` has no deadline, and a dropped connection still errors on its own.

### Nits 1, 2, 3, 5, 7: done

- ±20 % jitter on the retry backoff.
- `waitTurn(…, {early:false})` when the wait comes from `Retry-After`.
- Neutral «Tuzatish boshlanmadi» text.
- A specific message for a single-op 413.
- An empty-chunk guard.

### R3 (new, required): a version-only bump can still double-apply a landed chunk

I missed this in round 1. It exists because the queue is now kept after a lost response.

The trigger is a version-only update from outside the editor. `ResultView.onDownload` calls `ensureGenerationFresh(gen)`, then:

```
setGen(prev => ({ ...prev, fileVersion: r.fileVersion, docVersion: r.docVersion }))
```

This changes `docVersion` but leaves `doc` as it was. That `gen` is the `detail` passed into `useDocEdit`. Its `[g]` effect (`useDocEdit.ts` ~line 301) sees `g.docVersion > versionRef` and adopts `g.doc` together with the new `docVersion`, while the queue stays untouched.

Step by step:
1. A save of more than 50 ops runs. Chunk 1 succeeds, and `adoptKeepingQueue(last)` sets `gen.docVersion = v1` with the old `fileVersion`, so the file is now stale.
2. Chunk 2 commits on the server as v1+1, but its response is lost. The queue keeps chunk 2 and `uncertainRef` is set.
3. Before pressing «Saqlash» again, the user clicks «Yuklab olish».
4. `ensureGenerationFresh` sees the stale file and rebuilds. The server returns `docVersion = v1+1`. `setGen` stores v1+1 next to the v1 doc.
5. The `[g]` effect sets `docRef` to the v1 doc and `versionRef` to v1+1. The screen loses the queued edits, although `pending` still counts them.
6. The next «Saqlash» sends chunk 2 with `baseVersion = v1+1`. It passes the lock, so **chunk 2 is applied twice**. `reconcileLost` never runs, because there is no 409.

The same happens in a single-chunk save whenever the file was already stale, for example after an earlier failed rebuild.

**Fix (small, pick one):**
- **(a)** In the `[g]` effect, do not accept a newer `docVersion` while the queue is not empty or `uncertainRef` is set. Leave `versionRef` as it is, so the next save gets a 409 and `reconcileLost` decides.
- **(b)** Otherwise, only accept a newer `docVersion` when the incoming `doc` belongs to it: a full server response, not a `{…prev, docVersion}` patch.

Also make `ResultView.onDownload` merge only `fileVersion` from the rebuild result. If `r.docVersion > prev.docVersion`, refetch the generation instead.

Add a `doc-edit-save` test for this sequence: lost response, then a version-only `gen` bump, then Save. It should expect no second PATCH with the landed ops.

### Nit (optional)

If `reconcileLost` cannot fetch ("offline"), the 409 falls through to `settleFailure`. If that function's own `reload()` then succeeds, the whole queue is dropped with the old «qo'llanmadi» text. That needs two back-to-back transient failures, so it is rare. When `uncertainRef` is still set, reuse the honest «saqlangan bo'lishi mumkin» text there too.

## Orchestrator verification (4a36ca6): **APPROVE**
R3 fixed: `useDocEdit.ts` ignores a version-only bump while `queueRef` is non-empty or a response is unconfirmed (`uncertainRef`), so Save hits CAS 409 → landed-chunk reconciliation; download path updates only fileVersion. `tests/ui/doc-edit-save.test.mts` 15/15 via heavy2.sh (incl. the lost-response → download → save case).
