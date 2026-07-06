#!/usr/bin/env bun
// Layer-boundary guard (Task 0.2). Fails the build on:
//   1. an UPWARD import (e.g. types/ importing analysis/),
//   2. a check importing a SIBLING check (analysis/checks/a importing analysis/checks/b),
//   3. `transpile/` reaching above `types` (it may consume only syntax·symbols·types).
//
// ponytail: regex import-scan over src/, not a full TS-parse graph. Ceiling: misses imports written
// across lines or via computed specifiers (we don't do that). Upgrade path: swap in dependency-cruiser
// if the rules outgrow this — but a downward-only rule doesn't need a graph engine.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")

// Layer rank: import target rank must be <= source rank. The spec groups reference+graphical as "F",
// but they sit at DIFFERENT dependency levels: `reference` is a data catalog (depends only on `types`,
// consumed BY analysis + services), while `graphical` reuses the services core (so it sits above them).
const RANK: Record<string, number> = {
  syntax: 0,
  symbols: 1,
  types: 2,
  reference: 3,
  analysis: 4,
  services: 5,
  graphical: 6,
  server: 7,
}
// transpile is a sibling backend, not a stack rung: it may only reach A·B·C.
const TRANSPILE_ALLOWED = new Set(["syntax", "symbols", "types"])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

// First path segment under src/ = the file's layer (or null for top-level files like index.ts/bin.ts).
function layerOf(file: string): string | null {
  const rel = relative(SRC, file).replaceAll("\\", "/")
  const seg = rel.split("/")[0]
  return rel.includes("/") ? seg : null
}

// A check file: analysis/checks/<group>/<name>.ts with a non-underscore name (excludes _shared, barrels).
function isCheckFile(rel: string): boolean {
  const parts = rel.split("/")
  return parts.length === 4 && parts[0] === "analysis" && parts[1] === "checks" && !(parts[3] as string).startsWith("_")
}

// Matches `import x from "y"`, `export * from "y"`, and bare side-effect `import "y"`.
const IMPORT_RE = /(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?["']([^"']+)["']/g

const violations: string[] = []

for (const file of walk(SRC)) {
  const srcLayer = layerOf(file)
  if (!srcLayer) continue // top-level barrel/bin may import any layer
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1]
    if (!spec.startsWith(".")) continue // external / package import — not our concern
    const targetFile = resolve(dirname(file), spec)
    const tgtLayer = layerOf(targetFile)
    if (!tgtLayer || tgtLayer === srcLayer) {
      // same layer is fine — except sibling checks (rule 2, handled below)
    }
    const relFrom = relative(SRC, file).replaceAll("\\", "/")
    const relTo = relative(SRC, targetFile).replaceAll("\\", "/")

    // Rule 3: transpile reach.
    if (srcLayer === "transpile" && tgtLayer && !TRANSPILE_ALLOWED.has(tgtLayer)) {
      violations.push(`${relFrom} → ${relTo}: transpile may only import syntax·symbols·types`)
      continue
    }
    // Rule 1: upward import between stack layers.
    if (srcLayer in RANK && tgtLayer && tgtLayer in RANK && RANK[tgtLayer] > RANK[srcLayer]) {
      violations.push(`${relFrom} → ${relTo}: upward import (${srcLayer} must not import ${tgtLayer})`)
      continue
    }
    // Rule 2: a check must not import a sibling check. A "check file" is
    // analysis/checks/<group>/<name>.ts with a non-`_` name; shared helpers (`_shared.ts`, group
    // barrels) are exempt. Check→check imports (peers) are the violation.
    if (isCheckFile(relFrom) && isCheckFile(relTo) && relFrom !== relTo) {
      violations.push(`${relFrom} → ${relTo}: a check must not import a sibling check`)
    }
  }
}

if (violations.length) {
  console.error(`✗ layering: ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log("✓ layering: imports point downward only")
