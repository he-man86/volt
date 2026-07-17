import type { Key } from "~/i18n"

// VOLT: the rebrand overlay. Volt-owned strings that replace opencode's product copy, merged OVER the locale dict
// in ~/context/i18n — so i18n/en.ts (and every other locale) stays byte-identical to opencode and keeps merging
// conflict-free on a bump. Editing en.ts to rebrand is the thing this file exists to prevent.
//
// Scope: only keys the LOGGED-IN console renders. opencode's dormant marketing pages (go.*, black.*, zen.*) keep
// their own copy — unlinked, never shown, not worth diverging over. A missing key just falls through to opencode's.
export const volt: Partial<Record<Key, string>> = {
  // Rendered by app.tsx:18 as the meta description of EVERY page, authed included — opencode's value is
  // "OpenCode - The open source coding agent." The <Title> next to it was rebranded and this was missed. Fixed here
  // rather than in app.tsx: the overlay costs no divergence, app.tsx is already a hand-merge on every bump.
  "app.meta.description": "Volt — version-controllable PLC projects, with an agent that understands them.",

  "workspace.usage.lite": "Gateway (${{amount}})",

  "workspace.keys.subtitle": "Manage your API keys for accessing Volt services.",
  "workspace.keys.empty": "Create a Volt Gateway API key",

  "workspace.lite.subscription.message": "You are subscribed to the Volt Gateway plan.",
  "workspace.lite.subscription.selectProvider": 'Select "Volt AI" as the provider in your opencode config.',
  "workspace.lite.black.message":
    "You're currently subscribed to OpenCode Black or on the waitlist. Please unsubscribe first if you'd like to switch to Gateway.",
  "workspace.lite.other.message":
    "Another member in this workspace is already subscribed to Volt Gateway. Only one member per workspace can subscribe.",
  "workspace.lite.promo.description":
    "Volt Gateway starts at {{price}}, then $10/month, and provides reliable access to popular open coding models with generous usage limits.",
  "workspace.lite.promo.subscribe": "Subscribe to Gateway",

  // Shown in the CLI when a free-trial model lapses — user-visible outside the console, so it rebrands too.
  "zen.api.error.trialEnded":
    "Free promotion has ended for {{model}}. You can continue using the model by subscribing to Volt Gateway - {{link}}",
}
