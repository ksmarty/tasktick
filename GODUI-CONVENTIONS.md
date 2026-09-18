# GodUI conventions

The app runs on **GodUI + shadcn + Tailwind v4**. It was previously on MUI, and
before that on a hand-built iOS system. Read this before touching a component.

## The stack

| Layer | What it is |
|---|---|
| `src/components/godui/` | GodUI components, vendored source. Installed via the **`godui` MCP** (`godui_get_component`) because the shadcn CLI cannot reach the registry. |
| `src/components/ui/` | shadcn base primitives (button, input, checkbox, select, dialog, …). GodUI has none of these. |
| `src/app/globals.css` | GodUI's "Celestial Sapphire" tokens + the layout scale + z-index tokens. |
| `src/lib/utils.ts` | `cn()` — `clsx` + `tailwind-merge`. |

**Fetching a GodUI component:** call the MCP tool `godui_get_component` with the
exact name, then write the source to `src/components/godui/<name>.tsx`. Do not
try `npx shadcn add @godui/...`; the registry is unreachable from the CLI.
`src/components/godui/tab-bar.tsx` is the model for how a vendored file should
look: `'use client'`, a doc comment naming the registry entry, and an explicit
list of every local change.

## Icons

Two sets, and the split is deliberate:

- **`@svg-animated-icons/react`** — 347 hover-animated icons. Use these first.
  `import { CheckIcon } from '@svg-animated-icons/react/check'` (per-path, which
  keeps the bundle small) or the barrel. Props: `{ disableHover?, className? }`.
  Coverage: `check`, `checkbox`, `calendar`, `clock`, `timer`, `stopwatch`,
  `magnifying-glass` (search), `loop` (recurrence), `reload`/`update` (sync),
  `lightning-bolt` (priority), `drawing-pin`/`sewing-pin` (pinning), `gear`,
  `bell`, `speaker-*` (reminders), `plus`, `minus`, `trash`, `pencil-1`,
  `drag-handle-*`, `chevron-*`, `caret-*`, `dot`/`dot-filled` (calendar dots),
  `half-1`/`half-2`, `target`, `star`, `heart`, `moon`/`sun`, `globe`,
  `envelope-closed`, `paper-plane`, `clipboard-copy`, `link-1`, `eye-*`,
  `lock-closed`, `color-wheel`, `symbol`, `layers`, `dashboard`, `bar-chart`,
  `pie-chart`, `play`/`pause`/`stop`/`resume`, `person`/`people`, `archive`,
  `filter`, `share-1`, `download`, `upload`, `exclamation-circled`,
  `info-circled`, `cross-circled`.
- **`lucide-react`** — the fallback, for anything the animated set lacks (a
  plain `Search`, `Tag`, `Folder`, `Flag`, `Repeat`, `RefreshCw`). Prefer the
  animated one where both exist, because the animation is the point.

## Styling — and the spacing rule

Tailwind utilities in `className`, merged with `cn()`. No CSS modules, no
`styled()`, no inline `style` except for values that genuinely cannot be a class
(a measured pixel height, a drag transform).

**Every margin, padding and gap comes from a token.** This is the rule the whole
migration exists to enforce — the previous UI drifted, with one card padded 12px
and the next 16px and a third 14px, and the page gutter varying per screen.
Nothing was wrong on its own, which is exactly how it accumulated.

The four layout tokens (defined in `globals.css`):

| Token | Value | Use |
|---|---|---|
| `--spacing-gutter` | `1rem` | Horizontal gap between the page edge and any card. |
| `--spacing-card` | `1rem` | Inner padding of a card, both axes. |
| `--spacing-row` | `1rem` | Horizontal padding of a row inside a card. |
| `--spacing-stack` | `0.75rem` | Vertical gap between stacked cards. |

Used as `p-card`, `px-gutter`, `gap-stack`, `px-row`, `mt-stack`. Anything else
comes from Tailwind's own scale, which is a fixed 0.25rem ladder — the rule is
*never invent an arbitrary value*. `p-[13px]`, `mt-[7px]` and `gap-[18px]` are
banned. If a design needs a size that is not on the scale, the design is wrong.

`scripts/check-spacing.mjs` enforces this: it fails on arbitrary-value utilities
and on raw `style={{ margin… }}`, and prints a per-directory summary so drift is
visible rather than discovered in a screenshot.

Vertical rhythm: page content is a `flex flex-col gap-stack`, so the gap between
cards is stated once rather than repeated as `mb-*` on each card.

## Component mapping

| Need | Use |
|---|---|
| Button, Input, Textarea, Checkbox, Switch, Select, Radio, Label | `@/components/ui/*` (shadcn) |
| Dialog, Sheet, Popover, DropdownMenu, Tooltip, Tabs, Table, Badge, Avatar, Progress, Skeleton, Separator, ScrollArea, Collapsible, Alert | `@/components/ui/*` (shadcn) |
| Bottom navigation | `@/components/godui/tab-bar` |
| Bottom sheet / side sheet | `@/components/godui/drawer` |
| Toasts | `@/components/godui/toast` (`toast()`, `toast.success`, `toast.error`) |
| Segmented choice | `@/components/godui/segmented-control` |
| Collapsible section | `@/components/godui/accordion` |
| Header pill | `@/components/godui/dynamic-island` |
| Date picking | `@/components/ui/calendar` (react-day-picker) — convert to/from epoch ms at the edge |

Do **not** wrap a shadcn or GodUI component in another component just to rename
it. Import it directly.

## What NOT to change

- **No business logic.** Do not touch `src/lib/**` (other than presentation
  helpers), `src/server/**`, API routes, data fetching, or the store. This is a
  presentation change. Keep every hook's behaviour identical.
- **No new dependencies.** Installed: `tailwindcss` v4, `framer-motion`, `clsx`,
  `tailwind-merge`, `class-variance-authority`, `lucide-react`,
  `@svg-animated-icons/react`, and whatever `src/components/ui` already pulls in.
- **Do not change the palette.** GodUI's Celestial Sapphire is the point.
- **Do not edit** `src/app/globals.css`, `src/lib/utils.ts`, or files outside
  your assigned directory — they are shared and other agents are working.

## Colour scheme

The `dark` class on `<html>`. Read it with a `useTheme`-style hook if one
exists; do not invent a second mechanism. Do not read the `tasktick-theme`
cookie for rendering.

## Accessibility

Keep every `aria-label`, `role`, `aria-live` and keyboard handler that exists
today. When you replace a hand-rolled overlay with `Dialog`/`Drawer`, delete the
hand-rolled focus trap rather than layering it on top.

## Verifying

```sh
npx tsc --noEmit                 # must be zero errors
npx vitest run                   # must stay green
node scripts/check-spacing.mjs   # must pass
/tmp/tools/build-and-shoot.sh <name> <port> --both
```

Then **read the PNGs** in `/tmp/shots-<name>/` with the read tool and look at
them. A build that compiles is not a UI that works. Never run `next build`
directly — the harness serialises builds behind a lock.
