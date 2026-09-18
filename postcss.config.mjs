/**
 * PostCSS is configured but carries no plugins.
 *
 * Tailwind used to live here. The app is on MUI now, so there is no CSS build
 * step left — Emotion generates the styles at runtime and MUI's AppRouterCache
 * provider collects them on the server. The file is kept because Next reads it
 * when it exists, and removing it entirely changes nothing else; an empty
 * pipeline is honest about the fact that nothing transforms the CSS now.
 */
const config = {
  plugins: {},
};

export default config;
