// volt-www runtime config. The console (auth + download resolver) runs on its own host; volt-www is the static
// marketing site, so its CTAs link *across* to the console. The host is set at build time via VITE_CONSOLE_URL.
// The console host, baked in at build time via VITE_CONSOLE_URL (infra/www.ts sets it when volt-www deploys).
// Defaults to the production console at the apex. (When the console→app.${domain} domain split ships, update this
// + infra/www.ts to `app.volt-ai.dev`.)
export const CONSOLE_URL = (import.meta.env.VITE_CONSOLE_URL || "https://volt-ai.dev").replace(/\/+$/, "")

// /auth is the console's OpenAuth entry — it handles both sign-in and sign-up (new users are created on first
// login), so "Sign in" and "Start free" both point here.
export const authUrl = () => `${CONSOLE_URL}/auth`

// The Volt desktop installer: the Velopack one-installer that volt-scripts/build-app.ts publishes to GitHub
// Releases (he-man86/volt) via `vpk upload github`. Windows-only — Volt's PLC tooling (bridges, CODESYS) is
// Windows-native. `latest/download/...` always resolves to the newest release carrying the asset, so this never
// needs bumping per release. Override with VITE_INSTALLER_URL if the release repo/asset name changes.
export const INSTALLER_URL =
  import.meta.env.VITE_INSTALLER_URL ||
  "https://github.com/he-man86/volt/releases/latest/download/Volt-win-Setup.exe"

export const downloadUrl = () => INSTALLER_URL
