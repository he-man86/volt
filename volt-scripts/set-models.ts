#!/usr/bin/env bun
/**
 * set-models — load the Zen gateway model catalog (`models.json`) into the `ZEN_MODELS1..30` secrets.
 *
 * The gateway reads ONE JSON document that is split across 30 secrets (SST/Cloudflare cap secret size).
 * At runtime `console-core`'s `model.ts` concatenates `ZEN_MODELS1..30` verbatim, `JSON.parse`s the result,
 * and validates it with `ZenData` (ModelsSchema). This script does the inverse: minify `models.json`, slice
 * it into 30 chunks, and `sst secret load` them — the exact scheme opencode's `update-models.ts` uses.
 *
 * Usage:
 *   bun volt-scripts/set-models.ts              # write .env.models + print the load command
 *   bun volt-scripts/set-models.ts --apply dev  # ...and `sst secret load` it for the stage
 *
 * `models.json` is COMMITTED (no secrets) — provider API keys are `${VAR}` references. The values come from:
 *   - local:  `.env`   (DEEPSEEK_API_KEY=…, ANTHROPIC_API_KEY=…)
 *   - CI:     GitHub secrets passed to the deploy.yml set-models step (SST state is per-runner — see
 *             deploy-secrets.ts — so gateway keys must be substituted + set IN the deploy job).
 *
 * models.json shape (see packages/console/core/src/model.ts for the authoritative Zod schema):
 *   {
 *     "providers":  { <id>: { api, apiKey, format } },   // api ends in /v1; apiKey string or {name:key} pool
 *     "zenModels":  { <id>: { name, cost, providers } },  // <id> must match opencode-config provider.volt models
 *     "liteModels": { ... }                               // cheaper tier; {} if unused
 *   }
 *   cost.{input,output} are DOLLARS PER TOKEN = price_per_million / 1_000_000
 *   (billing does `cost * tokens * 100` → cents; handler.ts:1021). e.g. $3/M → 0.000003
 *   provider.format ∈ "anthropic" | "google" | "openai" | "oa-compat"  (DeepSeek = oa-compat)
 */
import { readFileSync, writeFileSync, rmSync } from "fs"

const PARTS = 30
const args = process.argv.slice(2)
const apply = args.includes("--apply")
const stage = apply ? (args[args.indexOf("--apply") + 1] ?? "dev") : "dev"
const file = args.find((a) => !a.startsWith("--") && a !== stage) ?? "models.json"

let raw: string
try {
  raw = readFileSync(file, "utf8")
} catch {
  console.error(`No ${file} — the committed gateway catalog.`)
  process.exit(1)
}

// models.json is committed WITHOUT secrets — API keys are `${VAR}` refs. Substitute from process.env (CI GitHub
// secrets) → .env (local). Every ${VAR} must resolve, so the keys stay bundled in .env like the other secrets.
const dotenv: Record<string, string> = {}
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m) dotenv[m[1]] = m[2].trim()
  }
} catch {
  /* no .env (e.g. CI) — rely on process.env */
}
const missing: string[] = []
raw = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v) => {
  const val = process.env[v]?.trim() || dotenv[v]
  if (!val) missing.push(v)
  return val ?? ""
})
// Missing keys → deploy an EMPTY-but-valid catalog (gateway serves nothing) rather than fail the deploy or leave
// a placeholder that JSON.parse chokes on. With keys present, this branch is skipped and the real catalog loads.
if (missing.length) {
  console.warn(`No value for: ${[...new Set(missing)].join(", ")} — loading an EMPTY gateway catalog (no models).`)
  raw = JSON.stringify({ providers: {}, zenModels: {}, liteModels: {} })
}

let json: any
try {
  json = JSON.parse(raw)
} catch (e) {
  console.error(`${file} is not valid JSON after substitution: ${(e as Error).message}`)
  process.exit(1)
}

// Light structural sanity — the gateway does full Zod validation at runtime; this catches the common mistakes
// (missing sections, a model pointing at a provider id that isn't declared) before a 20-minute deploy.
if (!json.providers || !json.zenModels) {
  console.error(`${file}: must have top-level "providers" and "zenModels" objects.`)
  process.exit(1)
}
for (const [mid, m] of Object.entries<any>(json.zenModels)) {
  for (const entry of Array.isArray(m) ? m : [m])
    for (const p of entry.providers ?? [])
      if (!(p.id in json.providers)) {
        console.error(`${file}: model "${mid}" references provider "${p.id}" not present in "providers".`)
        process.exit(1)
      }
}
// Minify, then pad to a multiple of PARTS so every one of the 30 chunks is non-empty (SST rejects an empty
// secret — a short catalog would otherwise leave trailing chunks ""). JSON.parse ignores the trailing spaces.
const compact = JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / PARTS) * PARTS, " ")
const size = compact.length / PARTS
const parts = Array.from({ length: PARTS }, (_, i) =>
  compact.slice(size * i, i === PARTS - 1 ? undefined : size * (i + 1)),
)
// Sanity: chunks must reconstruct the document exactly, and none may be empty.
if (parts.join("") !== compact) throw new Error("chunking is lossy — refusing to write corrupt ZEN_MODELS")
if (parts.some((p) => p.length === 0)) throw new Error("empty chunk — SST would reject it")

const outFile = ".env.models"
writeFileSync(outFile, parts.map((v, i) => `ZEN_MODELS${i + 1}="${v.replace(/"/g, '\\"')}"`).join("\n") + "\n")
console.log(`Wrote ${outFile} — ${compact.length} chars across ${PARTS} ZEN_MODELS secrets.`)

if (apply) {
  console.log(`Loading into stage "${stage}"…`)
  const { $ } = await import("bun")
  await $`bunx sst secret load ${outFile} --stage ${stage}`
  rmSync(outFile, { force: true }) // it holds the real keys; regenerate any time
  console.log(`Done. Run "sst deploy --stage ${stage}" (or the deploy workflow) to apply.`)
} else {
  console.log(`\nNext: review, then run  →  bunx sst secret load ${outFile} --stage <stage>   (then redeploy)`)
}
