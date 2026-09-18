# MUI migration — conventions

The app runs on **MUI 9 + Material Design**. It was migrated from a hand-built
iOS/"Liquid Glass" system (32 primitives, 268 custom properties, Tailwind) in one
pass; this file is both the record of that decision and the conventions to keep
following. Read it before touching a component.

## The rule

**Replace, do not wrap.**

Screens import MUI directly. There is no `@/components/ui` wrapper layer any
more — that whole directory was deleted, and a thin wrapper around a MUI
component is just a second API to keep in sync. If you need a MUI component,
import it:

```tsx
import Button from '@mui/material/Button';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
```

Do **not** create `src/components/mui/*` re-exports.

## Component mapping

| Old primitive | MUI |
|---|---|
| `Button`, `IconButton` | `Button`, `IconButton` |
| `TextField`, `Select`, `DateField`, `TimeField` | `TextField`, `Select`/`MenuItem`, `@mui/x-date-pickers` (`DatePicker`, `TimePicker`) |
| `Sheet` (bottom sheet) | `Drawer` with `anchor="bottom"`, or `Dialog` |
| `Toast` / `useToast` | now `@/components/app/Toast` (MUI `Alert` + `Slide`); the API is unchanged |
| `ConfirmDialog`, `ActionSheet` | `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` |
| `Popover` | `Popover` or `Menu` |
| `TabBar` | `BottomNavigation` + `BottomNavigationAction` |
| `SegmentedControl` | `ToggleButtonGroup` |
| `Switch` | `Switch` |
| `Checkbox` | `Checkbox` |
| `Chip` | `Chip` |
| `Avatar` | `Avatar` |
| `Badge` | `Badge` |
| `Divider` | `Divider` |
| `ListGroup`, `SectionHeader` | `List`, `ListSubheader`, `ListItem`, `ListItemButton`, `ListItemText` |
| `Skeleton` | `Skeleton` |
| `Spinner` | `CircularProgress` |
| `ProgressBar`, `ProgressRing` | `LinearProgress`, `CircularProgress` |
| `Tooltip` | `Tooltip` |
| `Toast` | `Snackbar` + `Alert` |
| `EmptyState` | `Stack` + `Typography` + `Button` |
| `NavBar` | `AppBar` + `Toolbar` |
| `Stepper` | `Stepper` |
| `ColorPicker` | `ToggleButtonGroup` of swatches |

## Styling

- **`sx` for everything.** No Tailwind utility classes in new or rewritten code.
  No `className` with Tailwind. No `cn()` / `clsx` / `tailwind-merge`.
- Values come from the theme, not from literals:
  `sx={{ p: 2, borderRadius: 2, color: 'text.secondary', bgcolor: 'background.paper' }}`.
  `p: 2` is `theme.spacing(2)` = 16px. Use the scale; do not write `padding: '16px'`.
- Palette keys: `primary`, `secondary`, `error`, `warning`, `info`, `success`,
  `text.primary`, `text.secondary`, `text.disabled`, `divider`,
  `background.default`, `background.paper`, `action.hover`, `action.selected`.
- Typography: use `<Typography variant="...">` (`h6`, `subtitle1`, `subtitle2`,
  `body1`, `body2`, `caption`, `overline`, `button`) rather than hand-setting
  `fontSize`/`fontWeight`.
- Icons: `@mui/icons-material`. The old `lucide-react` icons are being removed —
  pick the closest Material icon.

## Layout

- `Stack` (with `direction`/`spacing`) for one-dimensional layout, `Box` for
  everything else. `Grid` only for genuine two-dimensional grids.
- Mobile-first: the app is used one-handed on a phone. Prefer full-width list
  rows over small inline controls, and keep touch targets at Material's 48dp
  minimum (`IconButton` and `ListItemButton` already do this).
- The shell owns scrolling. A view must not add `min-h-dvh` or its own scroll
  container — the app pane scrolls.

## What NOT to change

- **No business logic.** Do not touch `src/lib/**`, `src/server/**`, API routes,
  hooks that fetch data, or the store. This is a presentation change only. If a
  component's logic is entangled with its markup, keep the logic identical and
  change only what renders.
- **No new dependencies.** MUI, Emotion, `@mui/icons-material`,
  `@mui/x-date-pickers` and `@fontsource/roboto` are installed. Nothing else.
- **Do not touch** `src/app/globals.css`, `src/theme.ts`, `src/app/layout.tsx`,
  `src/app/providers.tsx`, or `src/components/ui/**` (deleted) or `src/lib/cn.ts` (deleted).
- **Do not change the palette.** Material's palette is the point of the move.

## Colour scheme

MUI owns it. Use `useColorScheme()` from `@mui/material/styles` if you need the
resolved appearance. Do not toggle a `dark` class yourself and do not read the
`tasktick-theme` cookie.

## Accessibility

Keep every `aria-label`, `role`, `aria-live` and keyboard handler that is there
today. MUI handles focus management for its own overlays; if you replace a
hand-rolled overlay with `Dialog`/`Drawer`/`Menu`, delete the hand-rolled focus
trap rather than layering it on top.

## Verifying

```sh
npx tsc --noEmit                 # must be zero errors
npx vitest run                   # must stay green
/tmp/tools/build-and-shoot.sh <name> <port> --both
```

Then **read the PNGs** in `/tmp/shots-<name>/` with the read tool and look at
them. A build that compiles is not a UI that works. Never run `next build`
directly — the harness serialises builds behind a lock.
