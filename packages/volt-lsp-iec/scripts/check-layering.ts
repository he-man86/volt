#!/usr/bin/env bun
// Layer-boundary guard (Task 0.2). Fails the build on:
//   0. a folder under src/ that has no layer rank — it would be checked by nothing,
//   1. an UPWARD import (e.g. types/ importing analysis/),
//   2. a check importing a SIBLING check, or another check group's `_` helper,
//   3. `transpile/` reaching above `types` (it may consume only syntax·symbols·types),
//   4. inside `transpile/`, anything but `ir/` shared between lower/ and the backends,
//   5. an import CYCLE that spans layers.
//
// ponytail: regex import-scan over src/, not a full TS-parse graph. Ceiling: misses imports written
// across lines or via computed specifiers (we don't do that). Upgrade path: swap in dependency-cruiser
// if the rules outgrow this — but a downward-only rule doesn't need a graph engine.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")

// Layer rank: import target rank must be <= source rank. `reference` is a data catalog (depends only on `types`,
// consumed BY analysis + services), while `network` reuses the services core (so it sits above them).
const RANK: Record<string, number> = {
  syntax: 0,
  // network/text/ is the network-text FRONTEND (text→AST): it depends only on syntax, so it is ranked just above it and
  // both `services` and `network` consume it downward.
  "network-text": 0.5,
  symbols: 1,
  types: 2,
  reference: 3,
  analysis: 4,
  services: 5,
  network: 6,
  // the top-level app modules (workspace-refs, detect-vendor, init, source-extensions): file I/O over the analysis
  // stack, consumed by the server
  workspace: 6.5,
  server: 7,
}
// transpile is a sibling backend, not a stack rung: it may only reach A·B·C.
const TRANSPILE_ALLOWED = new Set(["syntax", "symbols", "types"])
// Sanctioned upward edges. `types → reference`: the type
// checker reads the read-only reference catalog for built-in return types — inherent coupling, like a
// checker reading its typed stdlib. Fixing it properly means binding built-ins into the symbol table.
const ALLOWED_UPWARD = new Set(["types→reference"])
// The top-level files that may import anything: the package barrel and the executable.
const BARRELS = new Set(["index.ts", "bin.ts"])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

// The file's layer: its first folder under src/ (network/text/ its own), a top-level module's "workspace", or null for
// a barrel.
function layerOf(file: string): string | null {
  const rel = relative(SRC, file).replaceAll("\\", "/")
  if (rel.startsWith("network/text/")) return "network-text"
  if (!rel.includes("/")) return BARRELS.has(rel) ? null : "workspace"
  return rel.split("/")[0]!
}

/** The check group of analysis/checks/<group>/<file>.ts, or undefined for any other file. */
function checkGroup(rel: string): string | undefined {
  const parts = rel.split("/")
  return parts.length === 4 && parts[0] === "analysis" && parts[1] === "checks" ? parts[2] : undefined
}
const isHelper = (rel: string): boolean => (rel.split("/")[3] ?? "").startsWith("_")

// Matches `import x from "y"`, `export * from "y"`, and bare side-effect `import "y"`.
const IMPORT_RE = /(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?["']([^"']+)["']/g

const violations: string[] = []

// Rule 0: a folder the rules do not know is checked by nothing. `graphical/` was renamed `network/` and the upward rule
// silently stopped covering it — the lint went on passing (consolidate-lsp-structure A1).
for (const name of readdirSync(SRC))
  if (statSync(join(SRC, name)).isDirectory() && !(name in RANK) && name !== "transpile")
    violations.push(`src/${name}/: no layer rank — add it to RANK in scripts/check-layering.ts`)

const graph = new Map<string, string[]>()

for (const file of walk(SRC)) {
  const srcLayer = layerOf(file)
  const relFrom = relative(SRC, file).replaceAll("\\", "/")
  const edges: string[] = []
  graph.set(relFrom, edges)
  const text = readFileSync(file, "utf8")
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1]!
    if (!spec.startsWith(".")) continue // external / package import — not our concern
    const targetFile = resolve(dirname(file), spec)
    const tgtLayer = layerOf(targetFile)
    const relTo = relative(SRC, targetFile).replaceAll("\\", "/")
    const tsTarget = relTo.replace(/\.js$/, ".ts")
    if (existsSync(join(SRC, tsTarget))) edges.push(tsTarget)
    if (!srcLayer) continue // a barrel/bin may import any layer

    // Rule 3: transpile reach — outward to A·B·C only.
    if (srcLayer === "transpile" && tgtLayer && tgtLayer !== "transpile" && !TRANSPILE_ALLOWED.has(tgtLayer)) {
      violations.push(`${relFrom} → ${relTo}: transpile may only import syntax·symbols·types`)
      continue
    }
    // Rule 4: inside transpile, `ir/` is the ONLY shared contract. `lower/` owns the semantics and the
    // backends (`interp/`, `emit/`) own none, so a backend importing the lowering — or each other — would
    // let a semantic decision drift out of its one home. Same-folder and the top barrel are exempt.
    if (srcLayer === "transpile" && tgtLayer === "transpile") {
      const part = (p: string) => p.split("/")[1] ?? ""
      const from = part(relFrom)
      const to = part(relTo)
      if (from !== to && from !== "index.ts" && to !== "ir") {
        violations.push(`${relFrom} → ${relTo}: inside transpile only ir/ is shared (lower/ and the backends stay apart)`)
        continue
      }
    }
    // Rule 1: upward import between stack layers.
    if (
      srcLayer in RANK &&
      tgtLayer &&
      tgtLayer in RANK &&
      RANK[tgtLayer]! > RANK[srcLayer]! &&
      !ALLOWED_UPWARD.has(`${srcLayer}→${tgtLayer}`)
    ) {
      violations.push(`${relFrom} → ${relTo}: upward import (${srcLayer} must not import ${tgtLayer})`)
      continue
    }
    // Rule 2: a check must not import a sibling check, nor another group's `_` helper. A "check file" is
    // analysis/checks/<group>/<name>.ts with a non-`_` name; `checks/_shared.ts` (the tree's) and a group's own `_`
    // helpers are exempt.
    const fromGroup = checkGroup(relFrom)
    const toGroup = checkGroup(relTo)
    if (fromGroup && toGroup && relFrom !== relTo) {
      if (!isHelper(relFrom) && !isHelper(relTo)) violations.push(`${relFrom} → ${relTo}: a check must not import a sibling check`)
      else if (isHelper(relTo) && fromGroup !== toGroup)
        violations.push(`${relFrom} → ${relTo}: a check group's \`_\` helper is internal to its group`)
    }
  }
}

// Rule 5: a cycle that spans layers — two layers that each need the other are one layer in disguise. Cycles inside one
// layer (a barrel and its modules) are ordinary; the sanctioned `types → reference` edge closes the one known cross cycle.
const seen = new Set<string>()
const onStack: string[] = []
const reported = new Set<string>()
const visit = (node: string): void => {
  if (onStack.includes(node)) {
    const cycle = onStack.slice(onStack.indexOf(node))
    const layers = new Set(cycle.map((f) => layerOf(join(SRC, f))).filter((l): l is string => l !== null))
    const sanctioned = [...layers].every((l) => l === "types" || l === "reference")
    const key = [...cycle].sort().join(" ")
    if (layers.size > 1 && !sanctioned && !reported.has(key)) {
      reported.add(key)
      violations.push(`import cycle across layers: ${[...cycle, node].join(" → ")}`)
    }
    return
  }
  if (seen.has(node)) return
  seen.add(node)
  onStack.push(node)
  for (const next of graph.get(node) ?? []) visit(next)
  onStack.pop()
}
for (const node of graph.keys()) visit(node)

if (violations.length) {
  console.error(`✗ layering: ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  ${v}`)
  process.exit(1)
}
console.log("✓ layering: every folder ranked, imports point downward only, no cross-layer cycle")
