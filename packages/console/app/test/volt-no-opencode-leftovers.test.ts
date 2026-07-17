import { expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { i18n } from "~/i18n"

// VOLT: the standing "no opencode leftovers" bar, encoded.
//
// The console is vendored opencode source, so opencode's product names, links and support addresses are the DEFAULT
// everywhere and leak back in every time upstream adds a string. Review does not catch them: they typecheck, they
// build, and they only show up in a running page or in a CLI error nobody reads during a PR. This has already bitten
// four times — the CLI's trial-ended error advertised "OpenCode Go", the gateway's billing errors linked
// opencode.ai's console, the Billing tab's "contact us" mailto went to opencode's inbox (help@anoma.ly), and every
// authed page's meta description read "OpenCode - The open source coding agent."
//
// Scope note: this bans opencode's BRANDING, not the word. opencode is a genuine runtime prerequisite that Volt's
// users install and run (`opencode auth login`), so naming it in setup instructions is factual and stays — see the
// FACTUAL allowlist. What must never appear is opencode's PRODUCTS (Go/Black/Zen), DOMAINS, or CONTACTS presented
// to a Volt user as if they were Volt's.

const SRC = join(import.meta.dir, "..", "src")

/**
 * opencode's brand surface: its domains, its company, its contacts, its product names.
 *
 * The `\bGo\b` arm was added after this test passed a page reading "Your friend joins and subscribes to Go" and
 * "toward your Go usage limits" — opencode names its tier bare, so an `opencode go` pattern never matched it. The
 * bare word is safe to ban HERE because this only scans keys the app RENDERS: opencode's own `go.*` marketing keys
 * ("Subscribe to Go", "How Go works") belong to a page Volt deleted, so nothing reaches them.
 */
const BRANDING = /opencode\.ai|anomalyco|anoma\.ly|opencode\s+(go|black|zen)|"opencode"|\bGo\b/i

/**
 * i18n keys that legitimately mention opencode, each with the reason it is not a leftover.
 * Anything not listed here must resolve clean — add to this list ONLY with a reason that survives review.
 */
const ALLOWED: Record<string, string> = {
  // NB: Volt's own setup copy ("Select \"Volt AI\" as the provider in your opencode config", `opencode auth login`)
  // needs no entry here — BRANDING matches opencode's PRODUCTS/DOMAINS/CONTACTS, not the bare word. Naming the
  // prerequisite a user installs is factual. That distinction is the point of this list being short.
  //
  // Unreachable: every one of these is gated behind `isBlack()`, and Volt does not sell the Black tier — Stage 2
  // deleted the entire /black subscribe flow, so no Volt workspace can ever hold a Black subscription. Left as
  // opencode's own strings rather than rebranded, because rebranding a dead path is divergence for nothing.
  "workspace.black.subscription.message": "unreachable: isBlack() is always false for Volt (no /black routes)",
  "workspace.black.waitlist.joined": "unreachable: Black waitlist has no entry point in Volt",
  "workspace.black.waitlist.ready": "unreachable: Black waitlist has no entry point in Volt",
  "workspace.lite.black.message": "unreachable: only rendered when isBlack()",
}

async function keysRenderedByTheApp(): Promise<string[]> {
  const keys = new Set<string>()
  for (const entry of await readdir(SRC, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue
    const text = await Bun.file(join(entry.parentPath, entry.name)).text()
    for (const [, key] of text.matchAll(/(?:i18n\.)?\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) keys.add(key!)
  }
  return [...keys]
}

test("no string the app renders carries opencode's branding", async () => {
  const keys = await keysRenderedByTheApp()
  expect(keys.length).toBeGreaterThan(100) // guard the guard: a broken scan must not pass vacuously

  const dict = i18n("en")
  const leftovers = keys
    .filter((k) => !(k in ALLOWED))
    .map((k) => [k, dict[k as keyof typeof dict]] as const)
    .filter(([, v]) => typeof v === "string" && BRANDING.test(v))
    .map(([k, v]) => `${k} = ${v}`)

  expect(leftovers).toEqual([])
})

test("the allowlist stays honest", async () => {
  const keys = new Set(await keysRenderedByTheApp())
  const dict = i18n("en")
  for (const key of Object.keys(ALLOWED)) {
    // An entry that no longer renders, or no longer mentions opencode, is stale — drop it rather than let it hide
    // a future leftover on the same key.
    expect({ key, rendered: keys.has(key) }).toEqual({ key, rendered: true })
    expect({ key, mentions: BRANDING.test(dict[key as keyof typeof dict] as string) }).toEqual({ key, mentions: true })
  }
})
