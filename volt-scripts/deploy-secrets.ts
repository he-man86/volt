#!/usr/bin/env bun
/**
 * deploy-secrets — generate a COMPLETE SST secrets file for `sst secret load`.
 *
 * The infra declares ~50 `sst.Secret`s (incl. ZEN_MODELS1..30) and `sst deploy` errors on the first UNSET
 * one. Your hand-edited `.env` only carries the ones you actually fill; this expands that to every declared
 * secret — real value from `.env` where present, else a non-empty `PLACEHOLDER` stub (SST treats an EMPTY
 * secret as unset and still errors, so the stub must be non-empty). Stubbed features are inert until the real
 * value is set with `sst secret set NAME <value> --stage <stage>`.
 *
 * Usage:
 *   bun volt-scripts/deploy-secrets.ts                 # writes .env.deploy + prints the load command
 *   bun volt-scripts/deploy-secrets.ts --apply dev     # writes it AND runs `sst secret load` for the stage
 *
 * `.env.deploy` is gitignored (`.env*`). Reads values from your current `.env`.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"

// Values resolve: process.env (CI passes real secrets here) → .env (local dev) → placeholder.
// IMPORTANT: SST secrets are per-state — secrets set from a dev laptop are NOT visible to a CI deploy
// (state is local + cloud-backed, passphrase-encrypted). So this runs INSIDE the CI deploy job too.
const env: Record<string, string> = {}
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
} catch {
  // no .env (e.g. CI) — rely on process.env + placeholders
}

// every `new sst.Secret("NAME")` with NO default (a default'd secret doesn't need setting) across infra/
const names = new Set<string>()
for (const f of readdirSync("infra").filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(join("infra", f), "utf8")
  for (const m of src.matchAll(/new sst\.Secret\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)) names.add(m[1])
}
const sorted = [...names].sort()

// Resolve each declared secret: process.env (CI GitHub secrets) → .env (local) → default → placeholder.
// SST rejects an empty secret as "missing", so the fallback must be non-empty, not "".
const PLACEHOLDER = "PLACEHOLDER_UNSET"

// Some secrets are JSON-parsed / URL-constructed at runtime — a bare "PLACEHOLDER_UNSET" makes those pages throw
// (e.g. Subscription.getLimits does JSON.parse(ZEN_LIMITS)). Give them a valid-SHAPED default so the app renders
// (the feature stays inert / zeroed) until a real value is set. Match the Zod schema in console-core.
const DEFAULTS: Record<string, string> = {
  ZEN_LIMITS: JSON.stringify({
    free: { promoTokens: 0, dailyRequests: 0, dailyRequestsFallback: 0, checkHeaders: {} },
    lite: { rollingLimit: 0, rollingWindow: 1, weeklyLimit: 0, monthlyLimit: 0 },
    black: {
      "20": { fixedLimit: 0, rollingLimit: 0, rollingWindow: 1 },
      "100": { fixedLimit: 0, rollingLimit: 0, rollingWindow: 1 },
      "200": { fixedLimit: 0, rollingLimit: 0, rollingWindow: 1 },
    },
  }),
}
const valueOf = (n: string) =>
  process.env[n]?.trim() ? process.env[n]! : env[n]?.trim() ? env[n] : (DEFAULTS[n] ?? PLACEHOLDER)
const body = sorted.map((n) => `${n}=${valueOf(n)}`).join("\n") + "\n"
writeFileSync(".env.deploy", body)

const filled = sorted.filter((n) => valueOf(n) !== PLACEHOLDER)
console.log(`Wrote .env.deploy — ${sorted.length} secrets (${filled.length} real, ${sorted.length - filled.length} PLACEHOLDER_UNSET).`)

const apply = process.argv.includes("--apply")
const stage = process.argv[process.argv.indexOf("--apply") + 1] || "dev"
if (apply) {
  console.log(`Running: sst secret load .env.deploy --stage ${stage}`)
  const { $ } = await import("bun")
  await $`bunx sst secret load .env.deploy --stage ${stage}`
} else {
  console.log(`\nNext: review, then run  →  bunx sst secret load .env.deploy --stage <stage>`)
}
