// @volt/web runtime config.
//
// This site is entirely static and has no backend to link to. The console and the AI gateway were deleted
// (openspec/changes/sell-cli-subscription); payment, licence keys and the customer portal will be Polar's,
// and the buy CTA points there once that is wired.
//
// Until then the commercial surface is CLOSED — both the download and the purchase flow render as
// "Coming soon" rather than as links, because a dead link is worse than an honest one.

/** Flip to false once the installer is published and the Polar checkout URL is set below. */
export const COMING_SOON = true

// The Volt desktop installer: the one-installer that volt-scripts/build-installer.ts publishes to GitHub
// Releases (he-man86/volt). Windows-only — Volt's PLC tooling (bridges, CODESYS) is Windows-native.
// `latest/download/...` always resolves to the newest release carrying the asset, so it never needs bumping
// per release. Override with VITE_INSTALLER_URL if the release repo or asset name changes.
const INSTALLER_URL =
  import.meta.env.VITE_INSTALLER_URL || "https://github.com/he-man86/volt/releases/latest/download/Volt-win-Setup.exe"

/** null while COMING_SOON — callers render a disabled control instead of a link. */
export const downloadUrl = () => (COMING_SOON ? null : INSTALLER_URL)

// Polar hosts checkout, and issues the licence key on subscription. Set VITE_CHECKOUT_URL (or hardcode the
// product link) when the Polar product exists — see openspec/changes/sell-cli-subscription task 2.1.
const CHECKOUT_URL = import.meta.env.VITE_CHECKOUT_URL || ""

/** null until a Polar checkout URL exists. */
export const checkoutUrl = () => (COMING_SOON || !CHECKOUT_URL ? null : CHECKOUT_URL)
