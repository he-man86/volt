import { expect, test } from "bun:test"
import { i18n } from "~/i18n"
import { volt } from "~/i18n/volt"

// VOLT: this pins WHERE the rebrand overlay merges. It must be inside i18n() itself, because that factory is the one
// thing every consumer shares: the client render goes through context/i18n.tsx, but six SERVER call sites build the
// dict straight from i18n() and never touch that context — routes/zen/util/{handler,ipRateLimiter,keyRateLimiter}.ts,
// routes/api/enterprise.ts, routes/auth/[...callback].ts, routes/bench/submission.ts. Merging in the context alone
// typechecks, builds, and renders the console correctly while silently shipping "OpenCode Go" to a paying Volt user's
// CLI via the gateway handler's error strings. That is exactly the regression this catches.

test("every overlay key wins over the locale dict, in i18n() itself", () => {
  for (const locale of ["en", "de"] as const) {
    for (const key of Object.keys(volt) as (keyof typeof volt)[]) {
      expect(i18n(locale)[key]).toBe(volt[key]!)
    }
  }
})

test("the CLI-facing gateway error is rebranded (the key that regressed)", () => {
  expect(i18n("en")["zen.api.error.trialEnded"]).toContain("Volt Gateway")
  expect(i18n("en")["zen.api.error.trialEnded"]).not.toContain("OpenCode")
})

test("keys the overlay does not define still fall through to opencode", () => {
  expect(i18n("en")["go.hero.title"]).toBe("Low cost coding models for everyone")
})
