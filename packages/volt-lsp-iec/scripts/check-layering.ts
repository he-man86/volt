#!/usr/bin/env bun
// Layer-boundary guard. Fails the build on:
//   0. a folder under src/ that has no layer rank — it would be checked by nothing,
//   1. an UPWARD import (e.g. types/ importing analysis/),
//   2. a check importing a SIBLING check, or another check group's `_` helper,
//   3. `transpile/` reaching above the front-end (it may consume only syntax·symbols·types),
//   4. inside `transpile/`, anything but `ir/` shared between lower/ and the backends,
//   5. an import CYCLE that spans layers,
// and the FRONT-END rules (openspec frontend-conformance design.md §5, P2–P5), over src/, test/, scripts/ and the
// top-level libraries/ — tests included:
//   F1. nothing in the front-end imports outside the front-end;
//   F2. outside a front-end sub-layer, only its `index.js` (or the front-end's own) is imported;
//   F3. inside the front-end, `library` imports nothing, `syntax` nothing but itself, `symbols` syntax and library,
//       `types` syntax, symbols and library — each through the other's index — and inside `syntax` the folder table;
//   F4. no sanctioned upward edge exists (there is no ALLOWED_UPWARD);
//   F5. the front-end reads no environment (`process.env`);
//   F6. no import cycle inside `syntax`.
// and the ANALYSIS rules A1–A6 (openspec analysis-conformance design.md §2; `analysisViolations` below), with their own
// shrinking list, KNOWN_ANALYSIS_VIOLATIONS.
//
// A violation this change has not yet removed is named in KNOWN_FRONTEND_VIOLATIONS; `test/frontend/layering.test.ts`
// fails on a violation not listed AND on a listed one that no longer occurs, so the list can only shrink.
//
// ponytail: regex import-scan, not a full TS-parse graph. Ceiling: misses imports written across lines or via computed
// specifiers (we don't do that). Upgrade path: swap in dependency-cruiser if the rules outgrow this.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const PACKAGE = resolve(import.meta.dir, "..")
/** The trees the front-end rules cover (rules 0–5 cover production `src/` only). */
const ROOTS = ["src", "test", "scripts", "libraries"]

// Layer rank: import target rank must be <= source rank. `reference` is a data catalog (depends only on `types`,
// consumed BY analysis + services), while `network` reuses the services core (so it sits above them).
const RANK: Record<string, number> = {
  library: 0,
  syntax: 0,
  symbols: 1,
  types: 2,
  // network-text/ is the network-text FRONTEND (text→AST): it depends only on syntax. Ranked above `types` it is an
  // ordinary consumer, and the front-end is ranks 0–2 with nothing interleaved (design.md "Where the tree lives").
  "network-text": 2.5,
  reference: 3,
  analysis: 4,
  services: 5,
  network: 6,
  // the top-level app modules (workspace-refs, source-extensions): file I/O over the analysis stack,
  // consumed by the server. A rank comment is a list of files and rots like one.
  workspace: 6.5,
  server: 7,
}
/** The front-end's sub-layers (design.md P2). */
const FRONTEND = new Set(["library", "syntax", "symbols", "types"])
/** What each front-end sub-layer may import besides itself (F3). */
const FRONTEND_MAY_IMPORT: Record<string, readonly string[]> = {
  library: [],
  syntax: [],
  symbols: ["syntax", "library"],
  types: ["syntax", "symbols", "library"],
}
/**
 * Inside `syntax/`, what each folder may import (design.md §2 "Import rules within the front-end"). A folder not
 * named here (the root files: span, identifier, print, index) is bound only by F1/F3.
 */
const SYNTAX_FOLDERS: Record<string, (target: string) => boolean> = {
  lex: (t) => t === "span.ts" || t.startsWith("lex/"),
  ast: (t) => t === "span.ts" || t.startsWith("lex/") || t.startsWith("ast/"),
  literal: (t) => t.startsWith("ast/") || t === "lex/vocabulary.ts" || t.startsWith("literal/"),
  format: (t) => t === "span.ts" || t.startsWith("lex/") || t.startsWith("ast/") || t.startsWith("format/"),
  pragmas: (t) => t === "span.ts" || t.startsWith("lex/") || t.startsWith("ast/") || t.startsWith("pragmas/"),
  parse: (t) => t !== "print.ts",
}
// transpile is a sibling backend, not a stack rung: it may only reach the front-end.
const TRANSPILE_ALLOWED = FRONTEND
// The top-level files that may import anything: the package barrel and the executable.
const BARRELS = new Set(["index.ts", "bin.ts"])

/**
 * The front-end violations this change has not removed yet (tasks.md 1.2 → 1.41). Each entry is a violation string
 * exactly as the scan spells it. The list may only shrink; it is empty when 1.41 closes.
 */
export const KNOWN_FRONTEND_VIOLATIONS: readonly string[] = [
]

/**
 * Violations of rules 0–5 that predate the front-end rules and lie outside the front-end — not this change's to remove,
 * named so the gate can still fail on a NEW one.
 */
export const KNOWN_OTHER_VIOLATIONS: readonly string[] = [
  "services/structure/semantic-tokens.ts → network/network-analyze.ts: upward import (services must not import network)",
]

/**
 * The analysis-rule violations (A1–A6 below) that openspec analysis-conformance has not removed yet, measured by the
 * rule itself (task 1.2). Each entry names the task that removes it; the list may only shrink.
 */
export const KNOWN_ANALYSIS_VIOLATIONS: readonly string[] = [
]

const slash = (p: string): string => p.split("\\").join("/")

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".ts")) out.push(p)
  }
  return out
}

/** Where a src/ path sits: its front-end sub-layer and the path inside it, or its consumer layer. */
interface Place {
  /** The layer: a front-end sub-layer, a consumer layer, "transpile", "workspace", or null for a barrel. */
  layer: string | null
  /** For a front-end file, its path inside its sub-layer (`parse/cursor.ts`); else undefined. */
  inner?: string
}
function placeOf(relSrc: string): Place {
  const parts = relSrc.split("/")
  if (parts.length === 1) return { layer: BARRELS.has(relSrc) ? null : "workspace" }
  if (parts[0] === "frontend") {
    if (parts.length === 2) return { layer: "frontend", inner: parts[1] }
    return { layer: parts[1]!, inner: parts.slice(2).join("/") }
  }
  if (FRONTEND.has(parts[0]!)) return { layer: parts[0]!, inner: parts.slice(1).join("/") }
  return { layer: parts[0]! }
}
/** Is this front-end place an index a consumer may import (a sub-layer's `index.ts`, or `frontend/index.ts`)? */
const isIndex = (p: Place): boolean => p.inner === "index.ts"
const inFrontend = (p: Place): boolean => p.layer !== null && (FRONTEND.has(p.layer) || p.layer === "frontend")

/** `checks/<group>/<file>.ts` group of an analysis check, or undefined. */
function checkGroup(rel: string): string | undefined {
  const parts = rel.split("/")
  return parts.length === 4 && parts[0] === "analysis" && parts[1] === "checks" ? parts[2] : undefined
}
const isHelper = (rel: string): boolean => (rel.split("/")[3] ?? "").startsWith("_")

// Matches `import x from "y"`, `export * from "y"`, and bare side-effect `import "y"`.
const IMPORT_RE = /(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?["']([^"']+)["']/g

/**
 * Every layering violation in the package, as stable strings (no line numbers). `pkg` is the package root to scan —
 * this package by default; the gate's own tests scan a scratch package with one planted violation.
 */
export function layeringViolations(pkg: string = PACKAGE): string[] {
  const violations: string[] = []
  const SRC = join(pkg, "src")

  // Rule 0: a folder the rules do not know is checked by nothing.
  for (const name of readdirSync(SRC))
    if (statSync(join(SRC, name)).isDirectory() && !(name in RANK) && name !== "transpile" && name !== "frontend")
      violations.push(`src/${name}/: no layer rank — add it to RANK in scripts/check-layering.ts`)
  if (existsSync(join(SRC, "frontend")))
    for (const name of readdirSync(join(SRC, "frontend")))
      if (statSync(join(SRC, "frontend", name)).isDirectory() && !FRONTEND.has(name))
        violations.push(`src/frontend/${name}/: not a front-end sub-layer — add it to FRONTEND in scripts/check-layering.ts`)

  const graph = new Map<string, string[]>()
  const syntaxGraph = new Map<string, string[]>()

  for (const root of ROOTS)
    for (const file of walk(join(pkg, root))) {
      const relPkg = slash(relative(pkg, file))
      const inSrc = relPkg.startsWith("src/")
      const relFrom = inSrc ? relPkg.slice(4) : relPkg
      const isTest = file.endsWith(".test.ts")
      const from: Place = inSrc ? placeOf(relFrom) : { layer: `(${root})` }
      const production = inSrc && !isTest
      const edges: string[] = []
      if (production) graph.set(relFrom, edges)
      const syntaxEdges: string[] = []
      if (production && from.layer === "syntax") syntaxGraph.set(relFrom, syntaxEdges)
      const text = readFileSync(file, "utf8")

      // F5: the front-end reads no environment.
      if (inSrc && inFrontend(from) && !isTest && /\bprocess\.env\b/.test(text))
        violations.push(`F5 ${relFrom}: reads process.env (the front-end reads no environment)`)

      // EXTENDS linking runs only inside `relink` (canonical order, then linkExtends — never apart, frontend-conformance
      // 1.27): a direct caller links a project in bind order, which is the state `canonicalize` exists to remove.
      if (relPkg !== "src/frontend/symbols/incremental.ts" && /import\s*\{[^}]*\blinkExtends\b[^}]*\}\s*from/.test(text))
        violations.push(`${relFrom}: imports linkExtends — call relink (canonicalize + linkExtends, never apart)`)

      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1]!
        if (!spec.startsWith(".")) continue // external / package import — not our concern
        const targetFile = resolve(dirname(file), spec)
        const tsTarget = slash(relative(pkg, targetFile)).replace(/\.js$/, ".ts")
        const targetInSrc = tsTarget.startsWith("src/")
        const relTo = targetInSrc ? tsTarget.slice(4) : tsTarget
        const to: Place = targetInSrc ? placeOf(relTo) : { layer: null }

        // ── the front-end rules (every root, tests included) ──
        if (inSrc && inFrontend(from)) {
          if (!targetInSrc || !inFrontend(to)) {
            violations.push(`F1 ${relFrom} → ${relTo}: the front-end imports outside the front-end`)
            continue
          }
          if (to.layer !== from.layer && from.layer !== "frontend") {
            const allowed = FRONTEND_MAY_IMPORT[from.layer!] ?? []
            if (to.layer === "frontend" || !allowed.includes(to.layer!)) {
              violations.push(`F3 ${relFrom} → ${relTo}: ${from.layer} must not import ${to.layer}`)
              continue
            }
            if (!isIndex(to)) {
              violations.push(`F3 ${relFrom} → ${relTo}: deep import (through ${to.layer}/index.js only)`)
              continue
            }
          }
          if (from.layer === "syntax" && to.layer === "syntax" && !isTest) {
            const folder = from.inner!.includes("/") ? from.inner!.split("/")[0]! : undefined
            const rule = folder === undefined ? undefined : SYNTAX_FOLDERS[folder]
            if (rule !== undefined && !rule(to.inner!) && to.inner!.split("/")[0] !== folder) {
              violations.push(`F3 ${relFrom} → ${relTo}: syntax/${folder} must not import syntax/${to.inner}`)
              continue
            }
          }
        } else if (targetInSrc && inFrontend(to) && !isIndex(to)) {
          violations.push(`F2 ${relFrom} → ${relTo}: deep import (a consumer imports the front-end through an index)`)
          continue
        }

        if (!production) continue
        if (targetInSrc && existsSync(join(pkg, tsTarget))) {
          edges.push(relTo)
          if (from.layer === "syntax" && to.layer === "syntax") syntaxEdges.push(relTo)
        }
        const srcLayer = from.layer
        const tgtLayer = to.layer
        if (!srcLayer || !targetInSrc) continue // a barrel/bin may import any layer
        const rankOf = (l: string | null): number | undefined =>
          l === null ? undefined : l === "frontend" ? RANK.types : RANK[l]

        // Rule 3: transpile reach — outward to the front-end only.
        if (srcLayer === "transpile" && tgtLayer && tgtLayer !== "transpile" && !TRANSPILE_ALLOWED.has(tgtLayer) && tgtLayer !== "frontend") {
          violations.push(`${relFrom} → ${relTo}: transpile may only import the front-end`)
          continue
        }
        // Rule 4: inside transpile, `ir/` is the ONLY shared contract.
        if (srcLayer === "transpile" && tgtLayer === "transpile") {
          const part = (p: string) => p.split("/")[1] ?? ""
          const f = part(relFrom)
          const t = part(relTo)
          if (f !== t && f !== "index.ts" && t !== "ir") {
            violations.push(`${relFrom} → ${relTo}: inside transpile only ir/ is shared (lower/ and the backends stay apart)`)
            continue
          }
        }
        // Rule 1: upward import between stack layers (F4: nothing is sanctioned).
        const sr = rankOf(srcLayer)
        const tr = rankOf(tgtLayer)
        if (sr !== undefined && tr !== undefined && tr > sr) {
          violations.push(`${relFrom} → ${relTo}: upward import (${srcLayer} must not import ${tgtLayer})`)
          continue
        }
        // Rule 2: a check must not import a sibling check, nor another group's `_` helper.
        const fromGroup = checkGroup(relFrom)
        const toGroup = checkGroup(relTo)
        if (fromGroup && toGroup && relFrom !== relTo) {
          if (!isHelper(relFrom) && !isHelper(relTo)) violations.push(`${relFrom} → ${relTo}: a check must not import a sibling check`)
          else if (isHelper(relTo) && fromGroup !== toGroup)
            violations.push(`${relFrom} → ${relTo}: a check group's \`_\` helper is internal to its group`)
        }
      }
    }

  // Rule 5: a cycle that spans layers — two layers that each need the other are one layer in disguise.
  // F6: a cycle inside syntax — the parser's modules form a DAG.
  for (const [g, crossLayer] of [
    [graph, true],
    [syntaxGraph, false],
  ] as const) {
    const seen = new Set<string>()
    const onStack: string[] = []
    const reported = new Set<string>()
    const visit = (node: string): void => {
      if (onStack.includes(node)) {
        const cycle = onStack.slice(onStack.indexOf(node))
        const key = [...cycle].sort().join(" ")
        if (reported.has(key)) return
        if (crossLayer) {
          const layers = new Set(cycle.map((f) => placeOf(f).layer).filter((l): l is string => l !== null))
          if (layers.size > 1) {
            reported.add(key)
            violations.push(`import cycle across layers: ${[...cycle, node].join(" → ")}`)
          }
        } else {
          reported.add(key)
          violations.push(`F6 import cycle in syntax: ${[...cycle, node].join(" → ")}`)
        }
        return
      }
      if (seen.has(node)) return
      seen.add(node)
      onStack.push(node)
      for (const next of g.get(node) ?? []) visit(next)
      onStack.pop()
    }
    for (const node of [...g.keys()].sort()) visit(node)
  }
  violations.push(...analysisViolations(pkg))
  return violations
}

/** A static `import … from "x"` / `export … from "x"` / `import "x"`, or a dynamic `import("x")` — the A rules count both. */
const ANY_IMPORT_RE = /(?:(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?|\bimport\(\s*)["']([^"']+)["']/g

/**
 * THE ANALYSIS RULES (openspec analysis-conformance design.md §2 "Import rules", P4), over src/, test/ and scripts/ —
 * tests included, a dynamic `import()` counted:
 *
 *   A1  analysis reaches the reference catalog only through `reference/index.js` (the front-end through its indexes is
 *       F2's; the network-text clause is parked with design.md §3);
 *   A2  outside `src/analysis/`, the only analysis file anyone imports is `analysis/index.js`;
 *   A3  a check imports no other check and never `pipeline/registry` or `pipeline/diagnostics`; a colocated test imports
 *       only its own subject in `checks/` (the pipeline through `analysis/index.js`);
 *   A4  nothing in analysis but the registry and the pipeline imports a check (`shared/`, `messages`, `config`,
 *       `pipeline/context` and the rest);
 *   A5  no analysis TEST imports a rank above analysis (production is rule 1's);
 *   A6  every `checks/<group>/<name>.ts` has `<name>.test.ts` beside it, and every such test has its subject beside it.
 *
 * Spelled like the other rules: src/ paths relative to src/, the rest relative to the package.
 */
function analysisViolations(pkg: string): string[] {
  const out: string[] = []
  const SRC = join(pkg, "src")
  for (const root of ROOTS)
    for (const file of walk(join(pkg, root))) {
      const relPkg = slash(relative(pkg, file))
      const inSrc = relPkg.startsWith("src/")
      const relFrom = inSrc ? relPkg.slice(4) : relPkg
      const isTest = file.endsWith(".test.ts")
      const fromAnalysis = relFrom.startsWith("analysis/") && inSrc
      const fromCheck = fromAnalysis && relFrom.startsWith("analysis/checks/")
      const text = readFileSync(file, "utf8")
      for (const m of text.matchAll(ANY_IMPORT_RE)) {
        const spec = m[1]!
        if (!spec.startsWith(".")) continue
        const tsTarget = slash(relative(pkg, resolve(dirname(file), spec))).replace(/\.js$/, ".ts")
        if (!tsTarget.startsWith("src/")) continue
        const relTo = tsTarget.slice(4)
        const toAnalysis = relTo.startsWith("analysis/")
        const toCheck = relTo.startsWith("analysis/checks/")
        const toPipelineRun = relTo === "analysis/pipeline/registry.ts" || relTo === "analysis/pipeline/diagnostics.ts"
        if (!fromAnalysis) {
          // the front-end importing analysis at all is F1's
          if (toAnalysis && relTo !== "analysis/index.ts" && !(inSrc && inFrontend(placeOf(relFrom))))
            out.push(`A2 ${relFrom} → ${relTo}: deep import (outside analysis, only analysis/index.js)`)
          continue
        }
        if (relTo.startsWith("reference/") && relTo !== "reference/index.ts")
          out.push(`A1 ${relFrom} → ${relTo}: deep import (analysis reads the reference catalog through reference/index.js)`)
        if (fromCheck && (toCheck || toPipelineRun)) {
          const subject = relFrom.replace(/\.test\.ts$/, ".ts")
          if (!isTest && toCheck && relTo !== relFrom) out.push(`A3 ${relFrom} → ${relTo}: a check imports no other check`)
          else if (isTest && toCheck && relTo !== subject)
            out.push(`A3 ${relFrom} → ${relTo}: a check's test imports only its own subject in checks/`)
          else if (toPipelineRun)
            out.push(`A3 ${relFrom} → ${relTo}: a check never imports the registry or the pipeline (its test goes through analysis/index.js)`)
        }
        if (!fromCheck && !isTest && toCheck && !isRegistryOrPipeline(relFrom))
          out.push(`A4 ${relFrom} → ${relTo}: only the registry and the pipeline import a check`)
        if (isTest && !toAnalysis) {
          const layer = placeOf(relTo).layer
          const rank = layer === null ? undefined : layer === "frontend" ? RANK.types : RANK[layer]
          if (rank !== undefined && rank > RANK.analysis!)
            out.push(`A5 ${relFrom} → ${relTo}: an analysis test imports a rank above analysis (${layer})`)
        }
      }
    }
  // A6, both directions
  const CHECKS = join(SRC, "analysis", "checks")
  if (existsSync(CHECKS))
    for (const group of readdirSync(CHECKS)) {
      const dir = join(CHECKS, group)
      if (!statSync(dir).isDirectory()) continue
      const names = new Set(readdirSync(dir).filter((n) => n.endsWith(".ts")))
      for (const n of [...names].sort()) {
        if (n.endsWith(".test.ts")) {
          if (!names.has(n.replace(/\.test\.ts$/, ".ts")))
            out.push(`A6 analysis/checks/${group}/${n}: no subject ${n.replace(/\.test\.ts$/, ".ts")} beside it`)
        } else if (!names.has(n.replace(/\.ts$/, ".test.ts")))
          out.push(`A6 analysis/checks/${group}/${n}: no colocated ${n.replace(/\.ts$/, ".test.ts")}`)
      }
    }
  return out
}

/** The analysis files that may import a check: the registry and the pipeline, and the index (which re-exports the
 *  syntax check's surface: `PARSE_ERROR_CODES` the server reads, `parseErrorMessage` the front-end dumps read). */
const isRegistryOrPipeline = (relFrom: string): boolean =>
  relFrom === "analysis/pipeline/registry.ts" ||
  relFrom === "analysis/pipeline/diagnostics.ts" ||
  relFrom === "analysis/index.ts"

/** The scan against the two known lists: what is new, and what is listed but no longer occurs. */
export function layeringReport(): { unexpected: string[]; stale: string[] } {
  const found = layeringViolations()
  const known = new Set([...KNOWN_FRONTEND_VIOLATIONS, ...KNOWN_OTHER_VIOLATIONS, ...KNOWN_ANALYSIS_VIOLATIONS])
  const foundSet = new Set(found)
  return {
    unexpected: [...new Set(found)].filter((v) => !known.has(v)),
    stale: [...known].filter((v) => !foundSet.has(v)),
  }
}

if (import.meta.main) {
  const { unexpected, stale } = layeringReport()
  if (unexpected.length + stale.length > 0) {
    if (unexpected.length) console.error(`✗ layering: ${unexpected.length} violation(s)`)
    for (const v of unexpected) console.error(`  ${v}`)
    if (stale.length) console.error(`✗ layering: ${stale.length} listed violation(s) no longer occur — remove them`)
    for (const v of stale) console.error(`  ${v}`)
    process.exit(1)
  }
  const pending = KNOWN_FRONTEND_VIOLATIONS.length + KNOWN_OTHER_VIOLATIONS.length + KNOWN_ANALYSIS_VIOLATIONS.length
  console.log(
    `✓ layering: every folder ranked, imports point downward only, no cross-layer cycle` +
      (pending ? ` (${pending} known violation(s) listed)` : ""),
  )
}
