import type { Key } from "~/i18n"

// VOLT: the rebrand overlay. Volt-owned strings that replace opencode's product copy, merged OVER the locale dict
// inside `i18n()` itself (~/i18n/index.ts) — so i18n/en.ts and every other locale stay byte-identical to opencode
// and keep merging conflict-free on a bump. Editing en.ts to rebrand is the thing this file exists to prevent.
//
// The merge point is load-bearing, so it is pinned by volt.test.ts: it must be the FACTORY, not ~/context/i18n.
// Merging in the render context covers the client only — six server call sites (the gateway handler, both rate
// limiters, /auth's callback, …) build their dict straight from i18n() and never touch that context. That exact
// mistake shipped "OpenCode Go" to paying users' CLIs while typechecking, building and rendering correctly.
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
  // PRICING — the numbers a customer reads before paying, so they track infra/console.ts, not opencode. Volt's
  // Gateway is a flat €24/month (`zenLitePrice`: currency "eur", unitAmount 2400) with no first-month discount
  // (core/src/billing.ts no longer default-applies opencode's 50% coupon). opencode's strings said "$5 for your
  // first month, then $10/month" — the same SHAPE as the truth-of-the-day with their currency and numbers, which is
  // why it read as plausible and shipped: a Volt customer was told $10/month and charged €24.
  // volt-price.test.ts pins both the figure and the no-discount default to the source.
  "workspace.lite.promo.price": "€24/month",
  "workspace.lite.promo.description":
    "Volt Gateway is {{price}} and provides reliable access to popular open coding models with generous usage limits.",
  "workspace.lite.promo.subscribe": "Subscribe to Gateway",

  // REFERRAL — opencode named its tier "Go" bare here, which the overlay's "OpenCode Go" pattern never matched.
  // The $5 is deliberately NOT changed to €5: the reward is credited against USAGE (core/src/referral.ts:18
  // REWARD_AMOUNT = 500 cents → Billing.subtractLiteUsage), and usage is metered from models.json's per-token
  // provider rates, which are USD. The subscription is EUR and the usage credit is USD — see the note in
  // DIVERGENCE.md; that mismatch is a product decision, not a string bug, so it is flagged rather than papered over.
  "workspace.referral.instructions.subscribe": "Your friend joins and subscribes to Volt Gateway",
  "workspace.referral.instructions.claim":
    "You both get a $5 usage credit to apply toward your Volt Gateway usage limits",
  "workspace.referral.rewards.description": "Apply available referral credits toward your Volt Gateway usage.",

  // Shown in the CLI when a free-trial model lapses — user-visible outside the console, so it rebrands too.
  "zen.api.error.trialEnded":
    "Free promotion has ended for {{model}}. You can continue using the model by subscribing to Volt Gateway - {{link}}",
}
