/**
 * The EDGE DIFFERENTIAL: the interpreter against the compiled Rust on inputs nobody recorded (split out of the
 * confidence module, transpile-restructure 1.8.3).
 */
import { CLOCK, LoopGuardError, run, type IrPou, type Runner } from "../../../../src/transpile/index.js"
import type { Type } from "../../../../src/frontend/types/index.js"
import type { LanguageTest } from "../../types.js"
import type { EdgeVerdict } from "../../fixtures/map-row.js"
import { compareOutcomes } from "../differential.js"
import { interpRender, seedable } from "../display.js"
import { runPaths } from "../run-paths.js"
import { type RustAccess, rustAccess } from "../rust-access.js"
import { preludeLines } from "./shape.js"
// the value model's REAL bits — a deep path, test support only (as the twin harness reads it)
import { floatFromBits } from "../../../../src/transpile/semantics/nan.js"

/*
 * THE INTERPRETER AGAINST THE COMPILED RUST, ON INPUTS NOBODY RECORDED — the review's step 3, as a column.
 *
 * `transpile-replay.test.ts` compares both backends to CODESYS on the values a fixture DECLARES. That says nothing about
 * the next input, which is where overflow, sign, NaN and truncation live. So every elementary variable the recorder
 * would read (`runPaths`) is seeded, one at a time, with each value below, the program is run for the fixture's
 * cycles in both backends, and every path is compared: same value, or both faulted.
 *
 *   integers       MIN, -1, 0, 1, MAX. "Overflow by one" and an out-of-range index are what MIN and MAX ARE to a
 *                  body that steps or indexes with them: one past the range is a wrap to the other end, which the
 *                  type cannot hold as a seed. An unsigned type has no -1; its -1 is its MAX.
 *   REAL / LREAL   ±0, ±1.5, ±2.5 (the tie rounding cases), the quiet NaN, a negative signalling NaN with a payload,
 *                  ±inf, ±MAX, the smallest subnormal and ±1e19 (beyond every integer a conversion could land in), all as
 *                  exact bit patterns.
 *   STRING         empty, and full to its capacity.
 *   BOOL           both.
 *
 * AGREEMENT IS NOT CORRECTNESS: the two backends share one IR, so they agree while both contradict CODESYS — the
 * review found most of its defects by hand for exactly that reason. `disagree` is a certain defect in one of them;
 * `agree` is only the absence of that one.
 *
 * NOT RUN WHERE THE ANSWER IS THE PLATFORM'S. `pow`, `ln`, `sin` and the rest are the operating system's libm on
 * both sides — Rust's `f64::powf` calls it, and so does the JS engine the interpreter runs on, except where it has a
 * path of its own — and IEEE-754 does not fix their last bit. Measured: `op_math_expt` and `expt_mixed_width`
 * disagree by one ULP on Windows. A verdict on those would be a fact about the machine that wrote the map, and the
 * gate recomputes it on Linux. So a program whose emitted Rust reaches libm is `not-run`, and says so; `sqrt`,
 * `abs`, `trunc` and the arithmetic operators are exact by the standard and stay in.
 *
 * DETERMINISTIC by construction: the inputs are fixed bit patterns, a CLOCKED fixture scans on a synthetic 10 ms per
 * scan in both backends rather than on a recorded instant, a NaN is compared by its BITS (both backends keep a NaN's
 * sign and payload since transpile-restructure 8.2 — a backend that flips, quiets or drops them where the other does not
 * disagrees; gate 8c), and the verdict does not depend on how many lanes ran or in what order.
 */

type InterpValue = Parameters<Runner["set"]>[1]
export interface EdgeSeed {
  label: string
  interp: InterpValue
  rust: string
}

const F32_EDGES: readonly (readonly [string, number])[] = [
  ["0", 0x00000000], ["-0", 0x80000000], ["1.5", 0x3fc00000], ["2.5", 0x40200000], ["-2.5", 0xc0200000],
  ["NaN", 0x7fc00000], ["-sNaN", 0xffa12345], ["+inf", 0x7f800000], ["-inf", 0xff800000], ["REAL_MAX", 0x7f7fffff], ["-REAL_MAX", 0xff7fffff],
  ["min_subnormal", 0x00000001], ["1e19", 0x5f0ac723], ["-1e19", 0xdf0ac723],
]
const F64_EDGES: readonly (readonly [string, bigint])[] = [
  ["0", 0x0000000000000000n], ["-0", 0x8000000000000000n], ["1.5", 0x3ff8000000000000n], ["2.5", 0x4004000000000000n],
  ["-2.5", 0xc004000000000000n], ["NaN", 0x7ff8000000000000n], ["-sNaN", 0xfff4000000012345n],
  ["+inf", 0x7ff0000000000000n], ["-inf", 0xfff0000000000000n],
  ["LREAL_MAX", 0x7fefffffffffffffn], ["-LREAL_MAX", 0xffefffffffffffffn], ["min_subnormal", 0x0000000000000001n],
  ["1e19", 0x43e158e460913d00n], ["-1e19", 0xc3e158e460913d00n],
]
// the value the bits encode, a NaN as its own bits (`NaNBits`), so both backends are seeded with the same NaN
const f32Of = (bits: number): InterpValue => floatFromBits(BigInt(bits), 32)
const f64Of = (bits: bigint): InterpValue => floatFromBits(bits, 64)

/** The edge inputs of one variable of type `t` — empty for a type that is not elementary. */
export function edgeSeeds(t: Type): EdgeSeed[] {
  const kind = seedable(t)
  if (kind === undefined || t.kind !== "elementary") return []
  if (kind === "bool")
    return [
      { label: "FALSE", interp: false, rust: "false" },
      { label: "TRUE", interp: true, rust: "true" },
    ]
  if (kind === "int") {
    const { bits, signed } = t.elem
    const values = signed
      ? [-(1n << BigInt(bits - 1)), -1n, 0n, 1n, (1n << BigInt(bits - 1)) - 1n]
      : [0n, 1n, (1n << BigInt(bits)) - 1n]
    return values.map((v) => ({ label: `${t.elem.name}#${v}`, interp: v, rust: `(${v}i128) as _` }))
  }
  if (kind === "real")
    return t.elem.bits === 32
      ? F32_EDGES.map(([l, b]) => ({ label: `REAL#${l}`, interp: f32Of(b), rust: `f32::from_bits(0x${b.toString(16)})` }))
      : F64_EDGES.map(([l, b]) => ({ label: `LREAL#${l}`, interp: f64Of(b), rust: `f64::from_bits(0x${b.toString(16)})` }))
  const capacity = t.length
  if (capacity === undefined) throw new Error(`a ${t.name} with no capacity cannot be seeded full`)
  return [
    { label: "''(empty)", interp: "", rust: "IecStr::new()" },
    {
      label: `'A'x${capacity}(max length)`,
      interp: "A".repeat(capacity),
      rust: `IecStr::lit(&[65${t.name === "WSTRING" ? "u16" : "u8"}; ${capacity}])`,
    },
  ]
}

interface EdgePath extends RustAccess {
  path: string
}
/** What one fixture's edge run seeds and compares — or why it cannot run. */
export type EdgePlan =
  | { paths: EdgePath[]; variants: { label: string; seed?: { p: EdgePath; s: EdgeSeed } }[]; cycles: number; clock?: EdgePath }
  | { notRun: string }

/** A transcendental the platform's libm computes — the last bit of its answer is not the repo's (see above). */
const LIBM_NAMES = "powf|powi|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|ln|log|log2|log10|exp|exp2|exp_m1|ln_1p|cbrt|hypot"
// a method call (`x.powf(y)`), or the routine handed to `iec_fn` by its path (`iec_fn(x, f64::ln)`, gate 8c)
const LIBM = new RegExp(`\\.(?:${LIBM_NAMES})\\(|\\bf64::(?:${LIBM_NAMES})\\b`)

/** Does this emitted code reach the platform's libm? Read off the code itself, so it is the same answer everywhere. */
export function reachesLibm(code: string): boolean {
  return LIBM.test(code.split("\n").slice(preludeLines(code)).join("\n"))
}

/** The variables a fixture's edge run seeds and compares: every recorder path the Rust can name as an elementary. */
export function edgePlan(t: LanguageTest, all: readonly LanguageTest[], pou: IrPou, code: string): EdgePlan {
  if (reachesLibm(code)) return { notRun: "reaches the platform's libm (pow, ln, sin…)" }
  const paths: EdgePath[] = []
  for (const path of runPaths(t, all)) {
    let access
    try {
      access = rustAccess(pou, path)
    } catch {
      continue // a path the recorder reads and the emitted struct does not hold as one field: nothing to compare
    }
    if (seedable(access.type) !== undefined) paths.push({ path, ...access })
  }
  if (paths.length === 0) return { notRun: "no elementary variable to seed or compare" }
  const variants: { label: string; seed?: { p: EdgePath; s: EdgeSeed } }[] = [{ label: "(declared inputs)" }]
  for (const p of paths) for (const s of edgeSeeds(p.type)) variants.push({ label: `${p.path} := ${s.label}`, seed: { p, s } })
  const clock = t.clock === undefined ? undefined : { path: CLOCK, ...rustAccess(pou, CLOCK) }
  return { paths, variants, cycles: t.cycles ?? 1, ...(clock === undefined ? {} : { clock }) }
}

/** The argument a harness's `main` takes to run the edge variants instead of its own body. */
export const EDGE_ARG = "edge"

/**
 * THE HARNESS'S LOOP GUARD — body entries one loop may make before a harness gives up on a run. CODESYS caps no
 * loop (`tr_27_loop_cap_*`), so neither backend does by default; but an edge seed can hand a loop a bound (or a
 * `WHILE flag`) nobody arranged, and a harness must still finish. The Rust a harness builds carries it
 * (`emitRust(pou, { loopGuard })`), above every recorded pass count (5,000,000, `tr_27_loop_cap_while_5000000`) since
 * the value pass shares that binary.
 */
export const HARNESS_LOOP_GUARD = 10_000_000

/**
 * The interpreter's guard on an EDGE variant — lower, because the interpreter is far slower than the Rust and a
 * runaway seed would otherwise cost seconds per variant (`cc6_loop_cannot_exit` has eleven). Both backends count
 * one body entry as one pass; a variant the interpreter gives up on has no answer, so it is not compared.
 */
const EDGE_INTERP_GUARD = 1_000_000

/**
 * The Rust that runs a plan's variants, and the `main` that dispatches to it — appended after the emitted code, so
 * the edge run shares the ONE compile each fixture already pays for. `body` is what `main` does otherwise: the value
 * pass prints the recorded paths there, the generator does nothing.
 */
export function edgeHarness(
  pou: IrPou,
  emitted: { usesGlobals: boolean; usesPrograms: boolean; usesImage: boolean },
  plan: EdgePlan,
  body: string,
): string {
  const edgeFns =
    "notRun" in plan
      ? "fn __volt_edge() {}\n"
      : (() => {
          const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : []), ...(emitted.usesImage ? ["&mut mem"] : [])].join(", ")
          const arms = plan.variants.flatMap((v, k) => (v.seed === undefined ? [] : [`        ${k} => { ${v.seed.p.write(v.seed.s.rust)} }`]))
          const scans =
            plan.clock === undefined
              ? `    for _ in 0..${plan.cycles} { p.scan(${args}); }`
              : `    for i in 1..=${plan.cycles}u64 { ${plan.clock.write("(i * 10_000_000) as _")} p.scan(${args}); }`
          const prints = plan.paths.map((p) => {
            const kind = seedable(p.type)
            const field = kind === "real" ? `(${p.read}).to_bits()` : `${p.read}${kind === "string" ? ".units()" : ""}`
            return `    println!("{}\\t${p.path}\\t{${kind === "string" ? ":?" : ""}}", k, ${field});`
          })
          return `#[allow(unused_mut, unused_variables, clippy::all)]
fn __volt_edge_run(k: usize) {
    let mut p = ${pou.name}::new();
${emitted.usesGlobals ? "    let mut g = Globals::new();\n" : ""}${emitted.usesPrograms ? "    let mut prg = Programs::new();\n" : ""}${emitted.usesImage ? "    let mut mem = Mem::new();\n" : ""}${pou.init === undefined ? "" : `    p.init(${args});\n`}    match k {
${arms.join("\n")}
        _ => {}
    }
${scans}
${prints.join("\n")}
}
fn __volt_edge() {
    std::panic::set_hook(Box::new(|i| {
        let m = i.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| i.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        println!("!\\t{}", m.replace('\\n', " "));
    }));
    let a: Vec<String> = std::env::args().collect();
    let (from, to) = if a.len() > 2 { let k: usize = a[2].parse().unwrap(); (k, k + 1) } else { (0, ${plan.variants.length}) };
    for k in from..to {
        println!("#\\t{}", k);
        if std::panic::catch_unwind(|| __volt_edge_run(k)).is_err() { println!("P\\t{}", k); } else { println!("{}\\t=done", k); }
    }
}
`
        })()
  return `${edgeFns}fn main() {\n    if std::env::args().nth(1).as_deref() == Some("${EDGE_ARG}") { __volt_edge(); return; }\n${body}}\n`
}

export interface EdgeOutcome {
  faulted: boolean
  /** The harness's loop guard gave up — no answer, so nothing to compare. */
  gaveUp?: boolean
  /** The variant printed its `=done` line — it ran to the end, as against a process that died inside it. */
  done: boolean
  values: Map<string, string>
}

/** One variant of an edge plan, run by the interpreter (its guard lower than the Rust's, see `EDGE_INTERP_GUARD`). */
export function interpOutcome(pou: IrPou, plan: Extract<EdgePlan, { paths: unknown }>, k: number): EdgeOutcome {
  const v = plan.variants[k]!
  let runner: Runner
  try {
    runner = run(pou, { loopGuard: EDGE_INTERP_GUARD })
  } catch (error) {
    return { faulted: true, gaveUp: error instanceof LoopGuardError, done: false, values: new Map() }
  }
  // OUTSIDE the fault catch: a seed the runner refuses (a path outside its array) is the harness's error, thrown as
  // one — inside it, the refusal read as the PROGRAM faulting.
  if (v.seed !== undefined) runner.set(v.seed.p.path, v.seed.s.interp)
  try {
    for (let i = 1; i <= plan.cycles; i++) {
      if (plan.clock !== undefined) runner.set(CLOCK, BigInt(i) * 10_000_000n)
      runner.scan()
    }
  } catch (error) {
    return { faulted: true, gaveUp: error instanceof LoopGuardError, done: false, values: new Map() }
  }
  return { faulted: false, done: true, values: new Map(plan.paths.map((p) => [p.path, interpRender(runner.get(p.path), p.type)])) }
}

function parseEdge(stdout: string): Map<number, EdgeOutcome> {
  const out = new Map<number, EdgeOutcome>()
  let current: EdgeOutcome | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.split("\t")
    if (parts[0] === "#") {
      current = { faulted: false, done: false, values: new Map() }
      out.set(Number(parts[1]), current)
    } else if (parts[0] === "P") {
      const o = out.get(Number(parts[1]))
      if (o !== undefined) o.faulted = true
    } else if (current !== undefined && parts.length >= 3) current.values.set(parts[1]!, parts.slice(2).join("\t"))
    else if (current !== undefined && parts[1] === "=done") current.done = true
  }
  return out
}

async function spawnEdge(argv: string[], timeoutMs: number): Promise<{ stdout: string; exit: number; killed: boolean }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    p.kill()
  }, timeoutMs)
  const [stdout, exit] = await Promise.all([new Response(p.stdout).text(), p.exited, new Response(p.stderr).text()])
  clearTimeout(timer)
  return { stdout, exit, killed }
}

/**
 * Run a built harness's edge variants and compare each with the interpreter. One process for all of them; a
 * process that dies part-way (a stack overflow aborts, it does not unwind) is re-run one variant per process, and a
 * variant that dies on its own counts as a fault — which is what CODESYS calls it too.
 *
 * A HANG IS NOT A VERDICT. Both backends are built with the harness's loop guard, so a variant that outlives its
 * timeout is a defect in one of them, and writing it down as `disagree` would make a timing fact a row of the map. It throws.
 */
export async function edgeVerdict(
  exe: string,
  pou: IrPou,
  plan: Extract<EdgePlan, { paths: unknown }>,
): Promise<EdgeComparison> {
  return compareEdge(pou, plan, await rustEdgeRun(exe, plan))
}

/** What a built harness's edge run printed, per variant — the Rust half of `edgeVerdict`, and the Rust outputs the
 *  transpile snapshot (`support/snapshot.ts`) records. */
export async function rustEdgeRun(exe: string, plan: Extract<EdgePlan, { paths: unknown }>): Promise<Map<number, EdgeOutcome>> {
  const all = await spawnEdge([exe, EDGE_ARG], 120_000)
  if (all.killed) throw new Error(`${exe}: the edge run did not finish in 120s — a hang in the emitted Rust`)
  let outcomes = parseEdge(all.stdout)
  const complete = [...outcomes.values()].filter((o) => o.faulted || o.done).length === plan.variants.length
  if (all.exit !== 0 || !complete) {
    outcomes = new Map()
    for (let k = 0; k < plan.variants.length; k++) {
      const one = await spawnEdge([exe, EDGE_ARG, String(k)], 60_000)
      if (one.killed) throw new Error(`${exe} ${EDGE_ARG} ${k}: did not finish in 60s — a hang in the emitted Rust`)
      const o = parseEdge(one.stdout).get(k) ?? { faulted: true, done: false, values: new Map() }
      if (one.exit !== 0) o.faulted = true
      outcomes.set(k, o)
    }
  }
  return outcomes
}

/** Why an edge row whose every variant the interpreter's loop guard gave up on is `not-run`. */
export const EDGE_ALL_GAVE_UP = "the interpreter's loop guard gives up on every variant"

/**
 * One fixture's edge comparison. `unanswered` counts the variants the interpreter's loop guard gave up on — there is
 * nothing to compare on those, so an `agree` rests on that many fewer variants than the plan holds, and a plan with no
 * answered variant is `not-run` (`EDGE_ALL_GAVE_UP`): an agreement on zero variants is not one. Absent when 0, and on
 * a `disagree` (the comparison stops at the first difference, so the count would be partial).
 */
export interface EdgeComparison {
  verdict: EdgeVerdict
  first?: string
  unanswered?: number
}

/** The edge verdict from the Rust's outcomes and the interpreter's — `interp` answers one variant (the snapshot hands a
 *  memo of the ones it already ran; the default runs it here). Stops at the first difference. */
export function compareEdge(
  pou: IrPou,
  plan: Extract<EdgePlan, { paths: unknown }>,
  outcomes: ReadonlyMap<number, EdgeOutcome>,
  interp: (k: number) => EdgeOutcome = (k) => interpOutcome(pou, plan, k),
): EdgeComparison {
  const paths = plan.paths.map((p) => p.path)
  let unanswered = 0
  for (let k = 0; k < plan.variants.length; k++) {
    const mine = interp(k)
    if (mine.gaveUp) {
      unanswered++
      continue
    }
    const rust = outcomes.get(k) ?? { faulted: true, done: false, values: new Map() }
    const label = plan.variants[k]!.label
    const [d] = compareOutcomes(mine, rust, paths, (_path, want, raw) => want === raw).differences
    if (d === undefined) continue
    if (d.kind === "fault")
      return { verdict: "disagree", first: `${label}: interpreter ${mine.faulted ? "faults" : "runs"}, Rust ${rust.faulted ? "panics" : "runs"}` }
    // `interpOutcome` answers every plan path of a run that did not fault: a path it left out is this harness's bug
    if (d.kind === "unanswered" && d.by === "interpreter") throw new Error(`${label}: the interpreter's outcome has no ${d.path}`)
    if (d.kind === "unanswered") return { verdict: "disagree", first: `${label}: Rust printed no ${d.path}` }
    return { verdict: "disagree", first: `${label}: ${d.path} interpreter ${d.interpreter}, Rust ${d.rust}` }
  }
  if (unanswered === plan.variants.length) return { verdict: "not-run", unanswered }
  return unanswered === 0 ? { verdict: "agree" } : { verdict: "agree", unanswered }
}
