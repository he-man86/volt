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
 *   bun volt-scripts/set-models.ts [models.json]              # write .env.models + print the load command
 *   bun volt-scripts/set-models.ts [models.json] --apply dev  # ...and `sst secret load` it for the stage
 *
 * Source of the catalog:
 *   - local:  `models.json` (gitignored — copy `models.example.json` → `models.json` and fill your keys)
 *   - CI:     the whole JSON in the `ZEN_MODELS_JSON` env var (a GitHub secret), so gateway keys land in the
 *             CI deploy's own SST state. Add a step to deploy.yml when you provision the gateway:
 *               - run: bun volt-scripts/set-models.ts --apply ${{ inputs.stage }}
 *                 env: { CLOUDFLARE_API_TOKEN, ZEN_MODELS_JSON: ${{ secrets.ZEN_MODELS_JSON }} }
 *             (SST state is per-runner — see deploy-secrets.ts — so gateway keys must be set IN the deploy job.)
 *
 * models.json shape (see packages/console/core/src/model.ts for the authoritative Zod schema):
 *   {
 *     "providers":  { <id>: { api, apiKey, format } },   // api ends in /v1; apiKey string or {name:key} pool
 *     "zenModels":  { <id>: { name, cost, providers } },  // <id> must match volt-config provider.volt models
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
if (process.env.ZEN_MODELS_JSON?.trim()) {
  raw = process.env.ZEN_MODELS_JSON // CI: whole models.json passed as one GitHub secret
} else {
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    console.error(`No ${file} (and no ZEN_MODELS_JSON) — copy models.example.json to ${file} and fill your keys.`)
    process.exit(1)
  }
}

let json: any
try {
  json = JSON.parse(raw)
} catch (e) {
  console.error(`${file} is not valid JSON: ${(e as Error).message}`)
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
if (raw.includes("<") && raw.includes(">")) {
  console.error(`${file}: still contains <placeholder> values — fill in your real API keys first.`)
  process.exit(1)
}

// Minify (the runtime concatenates chunks then JSON.parses, so store compact), then slice into 30 parts.
const compact = JSON.stringify(json)
const size = Math.ceil(compact.length / PARTS)
const parts = Array.from({ length: PARTS }, (_, i) =>
  compact.slice(size * i, i === PARTS - 1 ? undefined : size * (i + 1)),
)
// Sanity: chunks must reconstruct the document exactly (guards against an off-by-one in the slicing).
if (parts.join("") !== compact) throw new Error("chunking is lossy — refusing to write corrupt ZEN_MODELS")

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
