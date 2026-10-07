/**
 * SNAPSHOT S — THE TRANSPILER'S WHOLE OUTPUT PER FIXTURE (openspec transpile-restructure design.md §8, task 0.3). A
 * restructure step is output-neutral when `bun run snapshot:transpile check` compares identical against the baseline.
 *
 * Four LAYERS per fixture, each a text compared line by line:
 *
 *   ir       the canonical IR of the lowered POU — keys sorted, a `Type` rendered with `types/render` and followed by
 *            the facts its name does not print but the backends read (a folded capacity, an unfolded one, a
 *            subrange, an enum's base, a union, an array's folded bounds — `typeText`), a span as `line:col-line:col`, a bigint / NaN / ±0 / ±inf tagged, a reference cycle refused (never followed). A
 *            fixture that does not lower records its lowering diagnostics here, so a refusal that moves shows too.
 *   rust     the emitted Rust and its source map twice: the emission a user gets (no loop guard — what
 *            `rate:fixtures` rates as `shown`) and the harness's (with the loop guard, as the suite builds it).
 *   outputs  the interpreter's values after the fixture's scans on its declared inputs (every recorder path), and, per
 *            edge variant (`edgePlan`), what the interpreter and the compiled Rust each produced.
 *   edge     the edge verdict exactly as `rate:fixtures` writes it (`not-run` with its reason, `agree`, or `disagree`
 *            with the first difference).
 *
 * S-out (`--layers outputs,edge`) is the gate of a step that may change the Rust but not what it computes.
 *
 * The Rust is built through `support/rustc-cache.ts` with the suite's argv, and for every fixture whose code does not
 * reach the platform's libm with the very source `rate:fixtures` builds — so a snapshot after a regeneration costs no
 * compile. A libm-reaching fixture has no edge verdict (the map says `not-run`); its outputs are still recorded, from
 * a harness that seeds the same variants, so the snapshot still sees its Rust's values move.
 *
 * DETERMINISM: a clocked fixture scans on the edge run's synthetic 10 ms per scan in both halves (the recorded instants
 * are the value pass's business, not a neutrality check's); the interpreter runs with the harness's loop guard.
 */
import { rmSync } from "node:fs"
import { join } from "node:path"
import { renderType, type Type } from "../../../src/frontend/types/index.js"
import { CLOCK, emitRust, lowerSource, run, type IrPou, type LoweredPou } from "../../../src/transpile/index.js"
import type { LanguageTest } from "../types.js"
import { assembleFixture } from "./fixture-units.js"
import { PROJECT_BASE } from "./project-libraries.js"
import { runPaths } from "./run-paths.js"
import { CLIPPY, RUSTC } from "./rustc.js"
import { buildRust } from "./rustc-cache.js"
import {
  buildArgv,
  compareEdge,
  EDGE_ARG,
  edgeHarness,
  edgePlan,
  HARNESS_LOOP_GUARD,
  interpOutcome,
  reachesLibm,
  rustEdgeRun,
  type EdgeOutcome,
} from "./transpile-confidence.js"

export const LAYERS = ["ir", "rust", "outputs", "edge"] as const
export type Layer = (typeof LAYERS)[number]
/** One fixture's snapshot: a text per layer it has (a fixture that does not lower has only `ir`). */
export type FixtureSnapshot = Partial<Record<Layer, string>>

/** `--layers a,b` → the layers, refusing a name that is none. */
export function parseLayers(text: string): Layer[] {
  const out = text
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l !== "")
  for (const l of out) if (!(LAYERS as readonly string[]).includes(l)) throw new Error(`--layers: no layer '${l}' (${LAYERS.join(", ")})`)
  if (out.length === 0) throw new Error("--layers names no layer")
  return out as Layer[]
}

// ─── the canonical IR ────────────────────────────────────────────────────────────────────────────────────────

const TYPE_KINDS: ReadonlySet<string> = new Set([
  "elementary",
  "enum",
  "struct",
  "function_block",
  "interface",
  "array",
  "pointer",
  "reference",
  "static",
  "unknown",
])
/** The IR keys that hold a `Type` (`IrExpr.type`, `IrSlot.type`, `Place.type`, `lent[].type`, a bit access's `of`). */
const TYPE_KEYS: ReadonlySet<string> = new Set(["type", "of"])
const SPAN_KEYS = ["end", "endCol", "endLine", "start", "startCol", "startLine"].join()

const isType = (key: string, v: unknown): v is Type =>
  TYPE_KEYS.has(key) && v !== null && typeof v === "object" && TYPE_KINDS.has((v as { kind?: unknown }).kind as string)
const isSpan = (v: unknown): v is { startLine: number; startCol: number; endLine: number; endCol: number } =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === SPAN_KEYS

/** The facts of a `Type` its rendered name does not print and a backend reads, nested ones included — empty when none. */
function typeFacts(t: Type): string[] {
  const nested = (label: string, inner: Type): string[] => (typeFacts(inner).length === 0 ? [] : [`${label} ${typeText(inner)}`])
  switch (t.kind) {
    case "elementary":
      return [
        ...(t.length === undefined ? [] : [`length ${t.length}`]),
        ...(t.unfoldedLength === true ? ["unfolded length"] : []),
        ...(t.subrange === undefined ? [] : [`subrange ${t.subrange.lower}..${t.subrange.upper}`]),
      ]
    case "enum":
      return t.base === undefined ? [] : [`base ${typeText(t.base)}`]
    case "struct":
      return t.union === true ? ["union"] : []
    case "array":
      return [
        ...(t.bounds === undefined ? [] : [`bounds ${t.bounds.map((b) => `${b.lower}..${b.upper}`).join(",")}`]),
        ...nested("element", t.element),
      ]
    case "pointer":
    case "reference":
      return nested("target", t.target)
    default:
      return []
  }
}

/** A `Type` as the canonical IR holds it: its rendered name, then the facts the name hides (`{length 10}`). */
function typeText(t: Type): string {
  const facts = typeFacts(t)
  return facts.length === 0 ? renderType(t) : `${renderType(t)} {${facts.join("; ")}}`
}

/** Any lowered value as plain, stable JSON, one value per line. */
export function canonical(value: unknown): string {
  const onPath = new Set<object>()
  const norm = (x: unknown, key: string, where: string): unknown => {
    if (typeof x === "bigint") return `#${x}n`
    if (typeof x === "number") {
      if (Number.isNaN(x)) return "#NaN"
      if (Object.is(x, -0)) return "#-0"
      if (!Number.isFinite(x)) return x > 0 ? "#Infinity" : "#-Infinity"
      return x
    }
    if (x === null || typeof x !== "object") return x
    if (isType(key, x)) return `#type ${typeText(x)}`
    if (isSpan(x)) return `#span ${x.startLine}:${x.startCol}-${x.endLine}:${x.endCol}`
    if (onPath.has(x)) throw new Error(`canonical IR: a reference cycle at ${where} — the IR is a tree, a back-reference is not followed`)
    onPath.add(x)
    try {
      if (Array.isArray(x)) return x.map((v, i) => norm(v, "", `${where}[${i}]`))
      if (x instanceof Map) return { "#map": [...x].map(([k, v], i) => [norm(k, "", `${where}#k${i}`), norm(v, "", `${where}#v${i}`)]) }
      if (x instanceof Set) return { "#set": [...x].map((v, i) => norm(v, "", `${where}#${i}`)) }
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x).sort()) {
        const v = (x as Record<string, unknown>)[k]
        if (v !== undefined && typeof v !== "function") out[k] = norm(v, k, `${where}.${k}`)
      }
      return out
    } finally {
      onPath.delete(x)
    }
  }
  return JSON.stringify(norm(value, "", "$"), undefined, 1)
}

// ─── comparing ──────────────────────────────────────────────────────────────────────────────────────────────

const clip = (s: string): string => (s.length > 160 ? `${s.slice(0, 157)}...` : s)

/** The first difference between two snapshots of one fixture, in layer order — or undefined when they agree. */
export function firstDifference(before: FixtureSnapshot, after: FixtureSnapshot, layers: readonly Layer[]): string | undefined {
  for (const layer of LAYERS) {
    if (!layers.includes(layer)) continue
    const [b, a] = [before[layer], after[layer]]
    if (b === a) continue
    if (a === undefined) return `${layer}: in the baseline, not in this snapshot`
    if (b === undefined) return `${layer}: not in the baseline`
    const [bl, al] = [b.split("\n"), a.split("\n")]
    let i = 0
    while (i < bl.length && i < al.length && bl[i] === al[i]) i++
    return `${layer} line ${i + 1}: baseline ${JSON.stringify(clip(bl[i] ?? "<end>"))}, now ${JSON.stringify(clip(al[i] ?? "<end>"))}`
  }
  return undefined
}

/** One line per fixture that differs (its name first), in name order; empty when identical. A fixture with none of the
 *  requested layers equals a fixture the other side has no entry for: a stored set writes a line per fixture per layer
 *  it HAS, so a fixture that does not lower (only `ir`) is absent from an `outputs,edge` set and `{}` in a fresh take. */
export function compareSnapshots(
  before: ReadonlyMap<string, FixtureSnapshot>,
  after: ReadonlyMap<string, FixtureSnapshot>,
  layers: readonly Layer[],
): string[] {
  const out: string[] = []
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const [b, a] = [before.get(name), after.get(name)]
    const d = firstDifference(b ?? {}, a ?? {}, layers)
    if (d === undefined) continue
    if (a === undefined) out.push(`${name}: in the baseline, not in this snapshot`)
    else if (b === undefined) out.push(`${name}: not in the baseline`)
    else out.push(`${name}: ${d}`)
  }
  return out
}

// ─── taking one fixture's snapshot ──────────────────────────────────────────────────────────────────────────

/** What a harness binary is run with — the same probes the suite's builds name, so a cache entry is shared. */
const HARNESS_PROBES = [[], [EDGE_ARG]]

const failure = (e: unknown): string => `throws ${e instanceof Error ? e.message : String(e)}`

function rustText(emitted: ReturnType<typeof emitRust>): string {
  const map = emitted.sourceMap.map((m) => `${m.line}\t${m.uri ?? ""}\t${m.span.startLine}:${m.span.startCol}-${m.span.endLine}:${m.span.endCol}`)
  return `${emitted.code}\n--- source map ---\n${map.join("\n")}\n--- uses: globals ${emitted.usesGlobals}, programs ${emitted.usesPrograms}`
}

/** The `rust` layer: the emission a user gets (no loop guard) and the harness's (with it) — a restructure of the loop
 *  emission must hold in the branch the guard is NOT spliced into as well. */
export function rustLayer(pou: IrPou, harness: ReturnType<typeof emitRust> = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })): string {
  return ["--- the user's emission ---", rustText(emitRust(pou)), "--- the harness's emission (loop guard) ---", rustText(harness)].join("\n")
}

/** The interpreter on the fixture's declared inputs: its scans (a clock at 10 ms per scan), then every recorder path. */
function declaredRun(t: LanguageTest, all: readonly LanguageTest[], pou: IrPou): string[] {
  const out = [`declared inputs, ${t.cycles ?? 1} scan(s):`]
  let runner
  try {
    runner = run(pou, { loopGuard: HARNESS_LOOP_GUARD })
    for (let i = 1; i <= (t.cycles ?? 1); i++) {
      if (t.clock !== undefined) runner.set(CLOCK, BigInt(i) * 10_000_000n)
      runner.scan()
    }
  } catch (e) {
    return [...out, `  ${failure(e)}`]
  }
  for (const path of runPaths(t, all)) {
    try {
      out.push(`  ${path} = ${canonical(runner.get(path)).replace(/\n\s*/g, "")}`)
    } catch (e) {
      out.push(`  ${path} ${failure(e)}`)
    }
  }
  return out
}

const outcomeText = (o: EdgeOutcome | undefined): string =>
  o === undefined
    ? "no outcome"
    : o.gaveUp
      ? "gave up (loop guard)"
      : o.faulted
        ? "faults"
        : `${o.done ? "" : "(not done) "}${[...o.values].map(([p, v]) => `${p}=${v}`).join(" ")}`

/** One fixture's snapshot, the layers asked for. `dir` is a scratch directory for the Rust build. */
export async function snapshotFixture(
  t: LanguageTest,
  all: readonly LanguageTest[],
  layers: readonly Layer[],
  dir: string,
): Promise<FixtureSnapshot> {
  const out: FixtureSnapshot = {}
  let lowered: LoweredPou
  try {
    const { source, gvls } = assembleFixture(t, all)
    lowered = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE)
  } catch (e) {
    if (layers.includes("ir")) out.ir = failure(e)
    return out
  }
  const pou = lowered.pou
  if (pou === undefined) {
    if (layers.includes("ir")) out.ir = `refused\n${canonical(lowered.diagnostics)}`
    return out
  }
  if (layers.includes("ir")) out.ir = canonical(pou)
  const emitted = emitRust(pou, { loopGuard: HARNESS_LOOP_GUARD })
  if (layers.includes("rust")) out.rust = rustLayer(pou, emitted)
  if (!layers.includes("outputs") && !layers.includes("edge")) return out

  const libm = reachesLibm(emitted.code)
  // the plan as `rate:fixtures` makes it, minus the libm refusal (an empty code reaches no libm): for a fixture that
  // does not reach libm this IS that plan, and the source below is byte-identical to the generator's
  const plan = edgePlan(t, all, pou, "")
  const lines = declaredRun(t, all, pou)
  const compiler = CLIPPY ?? RUSTC
  if (compiler === null) throw new Error("snapshot:transpile needs `rustc` (or `clippy-driver`) on PATH for the outputs and edge layers")
  const file = join(dir, `${t.name}.rs`)
  const exe = join(dir, `${t.name}${process.platform === "win32" ? ".exe" : ""}`)
  const source = `${emitted.code}\n${edgeHarness(pou, emitted, plan, "")}`
  const build = await buildRust(buildArgv(compiler, file, { exe }), file, exe, source, HARNESS_PROBES)
  const built = build.exit === 0
  const rust = built && !("notRun" in plan) ? await rustEdgeRun(exe, plan) : undefined
  for (const f of [file, exe, exe.replace(/\.exe$/, ".pdb")]) rmSync(f, { force: true })
  const interp = new Map<number, EdgeOutcome>()
  const interpOf = (k: number): EdgeOutcome => {
    let o = interp.get(k)
    if (o === undefined && !("notRun" in plan)) interp.set(k, (o = interpOutcome(pou, plan, k)))
    return o!
  }
  if (!("notRun" in plan))
    for (let k = 0; k < plan.variants.length; k++) {
      lines.push(`#${k} ${plan.variants[k]!.label}`)
      lines.push(`  interp: ${outcomeText(interpOf(k))}`)
      lines.push(`  rust:   ${rust === undefined ? "does not build" : outcomeText(rust.get(k))}`)
    }
  out.outputs = lines.join("\n")
  // the verdict in `rate:fixtures`'s order: the build, then libm, then nothing to seed, then the comparison
  if (!built) out.edge = "not-run: the emitted Rust does not build"
  else if (libm) out.edge = "not-run: reaches the platform's libm (pow, ln, sin…)"
  else if ("notRun" in plan) out.edge = `not-run: ${plan.notRun}`
  else {
    const v = compareEdge(pou, plan, rust!, interpOf)
    out.edge = v.first === undefined ? v.verdict : `${v.verdict}: ${v.first}`
  }
  return out
}
