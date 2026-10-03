# Textarea policy

Owner decision (2026-10-03): no textarea in SlaydX can be resized by dragging its
corner. Each textarea has one of two behaviours, chosen per context:

- **auto**: the textarea grows and shrinks with the text, between a minimum and a
  maximum. Past the maximum it scrolls inside the box.
- **fixed**: the textarea has a set height and scrolls inside the box.

Every textarea is rendered with `components/common/AutoTextarea.tsx`. Do not use a
raw `<textarea>` in new code.

## Rules

| Context | Mode | Min → max |
|---|---|---|
| Short inputs: topic, description, prompt | auto | 2 → 8 rows |
| Character-limited fields (`LimitedTextarea`) | auto | 3 → 12 rows |
| Slide per-item fields (plan items, key ideas, …) | auto | 2 → 6 rows |
| Large source text (translation input) | auto | 6 rows → `60vh` |
| Read-only or output areas | fixed | `rows` lines, internal scroll |
| Admin reason fields (money, block, moderation, …) | auto | 2 → 6 rows |
| Admin broadcast text | auto | 5 → 16 rows |
| Admin direct message | auto | 4 → 12 rows |

- **Never a manual resize handle.** `AutoTextarea` always sets `resize: none`, and a
  caller's `style.resize` or a `resize-*` class cannot override it. Do not add `resize-y`.
- Do not put a `h-*`/`min-h-*`/`max-h-*` class on the textarea to size it. Use the props.
  The component also stays within a `max-height` set by CSS, so a stray class
  cannot clip the text.

## Usage

```tsx
import { AutoTextarea } from "@/components/common/AutoTextarea";

// auto (default): 2 → 8 rows
<AutoTextarea value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Mavzu" />

// auto with a viewport cap instead of a row cap
<AutoTextarea minRows={6} maxHeight="60vh" value={src} onChange={…} />

// fixed: 10 lines, scrolls inside
<AutoTextarea mode="fixed" rows={10} readOnly value={output} />
```

Props: the native `<textarea>` props pass through unchanged (`value`, `defaultValue`,
`onChange`, `maxLength`, `aria-*`, `data-*`, `className`, `style`, …), and so does
`ref`, which points at the `<textarea>`. The extra props are:

| Prop | Default | Meaning |
|---|---|---|
| `mode` | `"auto"` | `"auto"` grows with the content; `"fixed"` keeps a set height |
| `minRows` | `2` | auto: the smallest height. fixed: the height when `rows` is not given |
| `maxRows` | `8` | auto: the most rows shown before the box scrolls |
| `maxHeight` | — | auto: a CSS length (for example `"60vh"`) that replaces `maxRows` as the cap |
| `rows` | — | fixed: the number of visible lines. auto mode ignores it and uses `minRows` |

The height is measured again in these cases:

- the user types;
- `value` changes from code (a draft is restored, AI rewrites the text, or the field is reset to `""`);
- the width changes (`ResizeObserver`);
- web fonts finish loading;
- the component mounts.

The measurement temporarily sets the height to `auto` and reads `scrollHeight`. It
handles padding, border and `box-sizing`, and takes the line height from the computed
style (`1.5 × font-size` when that is `normal`). It does not move the caret, the
textarea's own scroll position or the page's scroll position.

Tests: `tests/ui/auto-textarea.test.mts`.
