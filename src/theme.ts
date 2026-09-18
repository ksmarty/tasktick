'use client';

import { createTheme } from '@mui/material/styles';

/**
 * The Material theme.
 *
 * This replaces the hand-built iOS design system: the 268 custom properties in
 * `globals.css` and the 32 primitives in `components/ui` are gone, and the app
 * now takes its colour, type, spacing, elevation and motion from Material
 * Design through MUI's theme.
 *
 * ## Palette
 *
 * Material's own palette, deliberately — not the previous iOS system colours.
 * That is the point of the move: a Material app that has been re-tinted to look
 * like iOS gets the worst of both, because every component's defaults (state
 * layers, elevation tints, contrast pairs, dark-mode surfaces) are tuned around
 * the palette they ship with. Overriding them means fighting each component.
 *
 * ## Colour scheme
 *
 * `cssVariables` emits the palette as CSS custom properties and switches them
 * on a class, so dark mode is a class swap on `<html>` rather than a re-render
 * of the tree. `InitColorSchemeScript` (in the root layout) applies it before
 * first paint, which is what keeps a dark-mode user from seeing a white flash.
 *
 * The values under `light`/`dark` are intentionally left at MUI's defaults: see
 * the note above. Only the type and shape below are app-specific.
 */
const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: { palette: { mode: 'light' } },
    dark: { palette: { mode: 'dark' } },
  },

  typography: {
    // Roboto is bundled through @fontsource rather than fetched from Google, so
    // the build needs no network and the installed PWA keeps its type offline.
    fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
  },

  shape: {
    // Material's default is 4. 8 reads better for a dense list-based app and is
    // still within Material's own scale.
    borderRadius: 8,
  },

  components: {
    /*
     * Mobile-first: the app is used one-handed on a phone, so the interactive
     * parts of a list row are full-width targets rather than inline text.
     */
    MuiListItemButton: {
      defaultProps: { dense: false },
    },
    /*
     * Material's default ripple is fine, but its default Button is noticeably
     * wider than the previous system's. `disableElevation` on contained buttons
     * keeps a toolbar of actions from looking like a stack of cards.
     */
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
  },
});

export default theme;
