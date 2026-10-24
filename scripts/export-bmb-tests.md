# Exporting the @BMB_testbot question bank (read-only runbook)

Documentation only. Nothing here is run by the repo, and nothing in SlaydX reads the bmbtestbot database or its bot
token. The lead runs these steps once, after the owner approves, on the server that hosts the bot, and then copies
ONLY the resulting `export.json` and the `images/` folder out. Findings behind this plan: `docs/program-17/bmbtestbot-analysis.md`.

What exists in the source (database `ques`, owned by the bot at `/home/ques/ques-bot`):

| table        | rows | notes |
|--------------|------|-------|
| `math`       | 130  | Matematika, variants 1..10 |
| `literature` | 130  | Ona tili |
| `history`    | 130  | Tarix |

Columns of each: `id`, `photo` (local path such as `math/img_3.png`, the file itself is NOT on the server), `file_id`
(Telegram file id of the uploaded screenshot), `answer` (one letter a-d, mixed case), `varyant` (1..10), `status`
('True' as text). Nothing else is needed. Do NOT export `accounts`, `referal`, `results`, `mandatorys`, `admins`
(Telegram ids and other personal data).

## 1. Read-only SQL

Run with a read-only role or inside a read-only transaction. psql, as the postgres superuser on the bot's host:

```sql
BEGIN READ ONLY;
\copy (SELECT 'math' AS subject, id, photo, file_id, lower(answer) AS answer_letter, varyant FROM math       WHERE status = 'True' ORDER BY varyant, id) TO 'bmb-math.csv'       CSV HEADER
\copy (SELECT 'ona_tili' AS subject, id, photo, file_id, lower(answer) AS answer_letter, varyant FROM literature WHERE status = 'True' ORDER BY varyant, id) TO 'bmb-ona_tili.csv' CSV HEADER
\copy (SELECT 'tarix' AS subject, id, photo, file_id, lower(answer) AS answer_letter, varyant FROM history    WHERE status = 'True' ORDER BY varyant, id) TO 'bmb-tarix.csv'    CSV HEADER
ROLLBACK;
```

Expected: 130 rows per file (variants 1-5 and 9-10 have 10 questions, variants 6-8 have 20). The importer
normalises the answer letter itself, `lower()` here is only for readability.

Mapping to `legacy_ref`: `bmb:<subject-table>:<id>`, with the table names `math`, `literature`, `history` (so
`bmb:literature:21` is row 21 of `literature`, which SlaydX shows under the subject code `ona_tili`). The id never
changes, which is what makes the import re-runnable.

## 2. Fetch the images (Telegram `getFile`)

The `file_id`s belong to the bot, so only the bot's own token can download them. Run this ON THE SERVER, with the token
taken from the bot's environment (variable `BOT_TOKEN` in its env file). Do not paste the token anywhere, do not
commit it, do not copy it off the server. Output goes to a new empty folder `images/`.

```bash
set -euo pipefail
# BOT_TOKEN is exported from the bot's env file in this shell; never echo it.
mkdir -p images
while IFS=, read -r subject id photo file_id answer variant; do
  [ "$subject" = "subject" ] && continue                     # CSV header
  file_id=${file_id//\"/}
  path=$(curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["file_path"])')
  ext=${path##*.}
  curl -fsS "https://api.telegram.org/file/bot${BOT_TOKEN}/${path}" -o "images/${file_id}.${ext}"
  sleep 0.1                                                  # stay far below Telegram's rate limits
done < <(cat bmb-math.csv bmb-ona_tili.csv bmb-tarix.csv)
```

Files are saved as `images/<file_id>.<jpg|png|webp>`; the importer finds them from the `file_id` field, so the
export JSON needs no `image_path`. (If the owner can supply the original `math/img*.png` files instead, put them
in `images/` under the same relative paths as `photo` and fill `image_path`.) Telegram re-encodes screenshots to
JPEG: expect roughly 20-150 KB each, 10-60 MB in total. Verify afterwards: `ls images | wc -l` is 390 and
`file images/* | grep -vc image` is 0.

## 3. Build `export.json`

One JSON file in the importer's format (see `lib/server/tests-import.ts`): subject -> variants -> questions. A
Python one-liner over the three CSVs is enough:

```python
import csv, json
SUBJECTS = [("math", "math", "Matematika"), ("literature", "ona_tili", "Ona tili"), ("history", "tarix", "Tarix")]  # (table, code, name)
subjects = []
for sort, (table, code, name) in enumerate(SUBJECTS):
    rows = list(csv.DictReader(open(f"bmb-{code}.csv")))
    variants = {}
    for r in rows:
        variants.setdefault(int(r["varyant"]), []).append(
            {"legacy_ref": f"bmb:{table}:{r['id']}", "file_id": r["file_id"], "answer_letter": r["answer_letter"]})
    subjects.append({"code": code, "name": name, "sort": sort,
                     "variants": [{"variant": v, "questions": q} for v, q in sorted(variants.items())]})
json.dump({"bank": {"slug": "bmb", "title": "Tayyor testlar banki", "source": "bmbtestbot"}, "subjects": subjects},
          open("export.json", "w"), ensure_ascii=False, indent=1)
```

Copy `export.json` and `images/` to a workstation (no secrets in either), then delete `bmb-*.csv`.

## 4. Import into SlaydX

Dry run first (validates everything, runs the import in a transaction and rolls it back; needs only `DATABASE_URL`):

```bash
scripts/heavy.sh npm run import:tests -- export.json images --dry-run
scripts/heavy.sh npm run import:tests -- export.json images
```

Expected summary: 390 questions inserted, up to 390 images stored (identical screenshots are stored once and a
duplicate question inside the same subject is skipped and listed), `math: 130 question(s) in 10 variant(s)` and the
same for the other two. A second run reports 390 unchanged. Spot-check 10 questions against the images by eye before
switching `tests.enabled` on in the admin settings: the answer keys were typed by hand and are unverified.
