/**
 * B↔C — THE INTERPRETER AND THE EMITTED RUST, COMPARED TO EACH OTHER.
 *
 * The transpiler has three oracles: the CODESYS recordings (A), `interp/` (B) and the emitted Rust (C). A↔B and
 * A↔C are gated. **B↔C was not gated at all** — the two backends were only ever compared THROUGH the
 * recordings, so they could disagree freely anywhere a recording does not reach. Five divergences were found
 * living exactly there, and every one of them was silent:
 *
 *   - the MOD expansion shadowed a parameter, so `7 MOD 3` compiled to `7 % 7` = 0 against the interpreter's 1;
 *   - no termination contract — the interpreter threw after a million iterations, the Rust ran forever;
 *   - `IrBuiltin` does not define argument evaluation, so a builtin argument with a side effect means two things;
 *   - `REAL → integer` saturates in Rust above `i64` and wraps in the interpreter;
 *   - unary negation of a REAL is `0 - x` in the interpreter, so `-0.0` comes out `+0.0`.
 *
 * **What this gate adds over A.** The recordings name SOME variables — `run-paths.ts` picks them, and the
 * recorder reads those. This compares EVERY place the same enumerator produces, after SEEDING the readable ones
 * so a body takes branches it would never take from declared initial values. Neither needs CODESYS, so it runs
 * on every push.
 *
 * **What it cannot do**: prove either backend right. Both can be wrong together and only A catches that. It
 * proves they are wrong together or not at all, which is the property that makes A's 625 programs meaningful
 * for the thousands of programs A has never seen.
 *
 * **Reals compare BIT-EXACTLY** (`to_bits()` against a DataView), because the `-0.0` divergence above is
 * invisible under `==` — a gate that cannot see one of the defects that motivated it is decoration.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lowerSource, rustAccess, run, type IrPou } from "../../src/transpile/index.js"
import type { Type } from "../../src/types/index.js"
import { ALL_TESTS } from "./fixtures/index.js"
import { assembleFixture, withDependencies } from "./support/fixture-units.js"
import { plcPrgSource } from "./support/plc-prg.js"
import { runPaths } from "./support/run-paths.js"
import { RUSTC as rustc, skipRustSuite } from "./support/rustc.js"
import { STANDARD_LIBRARY as LIBRARIES } from "./support/standard-library.js"
import type { LanguageTest } from "./types.js"

/**
 * How many fixtures are compiled. Each case is its own `rustc` invocation (~70ms), so the whole set would add
 * minutes to every push for a property that is dense rather than rare — a divergence in shared machinery shows
 * up in the first handful of cases that reach it.
 *
 * Deterministic (every Nth by sorted name, so the slice is stable across runs and reviewable in a diff) and
 * REPORTED: `skipped` is logged, never silent. Raise it when a divergence is suspected and the sample missed it.
 */
const SAMPLE = 120

const pathHash = (path: string): number => {
  let h = 0
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

const seedFor = (path: string): number => pathHash(path) % 97

/**
 * A REAL's seed spans MAGNITUDES, not just 0..96.
 *
 * Every seed was a small integer, and seeding OVERWRITES a declared initial value — so `probe_real_to_int_range`,
 * whose whole subject is what `LREAL_TO_DINT` does above the i64 range, declared `1.0E19` and then compared the two
 * backends on 43. The probe could not fail for the reason it exists, and that is why this gate never caught the
 * divergence its own header describes finding by hand.
 *
 * The ladder keeps the small values (most bodies want an ordinary number) and adds the edges where the two backends
 * are known to part: past i64, far past it, and a fraction that rounds half away from zero. Chosen by the same path
 * hash, so it stays deterministic and reviewable in a diff.
 */
const REAL_SEEDS: readonly number[] = [0, 1, 2.5, -2.5, 42, 1e19, -1e19, 1e30, -1e30]
const realSeedFor = (path: string): number => REAL_SEEDS[pathHash(path) % REAL_SEEDS.length]!

interface Case {
  name: string
  pou: IrPou
  paths: { path: string; type: Type; global: boolean; expr: string }[]
  cycles: number
  /**
   * The source calls a TRANSCENDENTAL (`EXPT`, `SQRT`, `LN`, `SIN`, …), so its REAL results compare within a few ULP
   * rather than bit-exactly.
   *
   * Not a softening of the rule that motivated this gate — `-0.0` is still caught, and every other value is still
   * compared bit for bit. It is that `Math.pow` and Rust's `powf` are different libm implementations, and at extreme
   * magnitudes they legitimately disagree in the last bits: the seed ladder feeds `EXPT` a base of 1.0E19, and
   * 1.0E19^8 comes back 9.999999999999998e151 here and 1e152 there. Neither is wrong, no recording covers that input,
   * and the fixture's OWN value (2^8 = 256) is exact in both. Demanding bit-equality of a transcendental across two
   * libms is demanding something neither backend promises.
   */
  transcendental: boolean
}

/** The one-argument math functions and EXPT — `IrMathName` plus `expt`, as the vendor spells them in ST. */
const TRANSCENDENTAL = /\b(EXPT|SQRT|LN|LOG|EXP|SIN|COS|TAN|ASIN|ACOS|ATAN)\s*\(/i

function prepare(t: LanguageTest): Case | undefined {
  const { source: rest, gvls } = assembleFixture(t, ALL_TESTS)
  const { pou } = lowerSource(rest, "PLC_PRG", [...LIBRARIES, ...gvls])
  if (pou === undefined) return undefined
  const transcendental = TRANSCENDENTAL.test(rest)
  const paths: Case["paths"] = []
  for (const path of runPaths(t, ALL_TESTS)) {
    try {
      const { expr, type, global } = rustAccess(pou, path)
      paths.push({ path, type, global, expr })
    } catch {
      // a path the emitter cannot address is not a divergence — it is outside this gate's reach
    }
  }
  return paths.length === 0 ? undefined : { name: t.name, pou, paths, cycles: t.cycles ?? 1, transcendental }
}

/** Seedable = a scalar both backends can be handed a literal for. Strings and composites are READ, not seeded. */
const seedable = (t: Type): "int" | "real" | "bool" | undefined => {
  if (t.kind !== "elementary") return undefined
  const f = t.elem.family
  return f === "int" || f === "bitstring" ? "int" : f === "real" ? "real" : f === "bool" ? "bool" : undefined
}

/**
 * ONE WIRE FORMAT FOR BOTH BACKENDS. A string is compared as its UNITS, the way the recorder's harness already
 * does it — Rust prints `IecString::units()` and this prints the same list — because Debug's `\u{c}` for a form
 * feed is not comparable text. The first run of this gate reported four "divergences" that were only the
 * interpreter printing `abcdefg` where Rust printed `[97, 98, …]`: a harness that formats the two sides
 * differently manufactures divergences and hides real ones underneath them.
 */
function render(v: unknown, wide: boolean): string {
  if (typeof v === "number") return bitsOf(v, wide)
  if (typeof v === "string") return `[${[...v].map((ch) => ch.charCodeAt(0)).join(", ")}]`
  return String(v)
}

/** One number's exact bits, so a REAL comparison cannot be fooled by `-0.0 === 0.0`. */
function bitsOf(v: number, wide: boolean): string {
  const buf = new DataView(new ArrayBuffer(8))
  if (wide) {
    buf.setFloat64(0, v)
    return buf.getBigUint64(0).toString()
  }
  buf.setFloat32(0, v)
  return String(buf.getUint32(0))
}

/**
 * An OUTCOME, not a value map — because a seeded run can legitimately fault.
 *
 * Seeding arbitrary values into arbitrary places makes a program do things its author never arranged: the first
 * run of this gate seeded a loop counter and drove an array index out of bounds, which the interpreter refuses
 * loudly and correctly. That is not a divergence; it is the harness handing the program bad input.
 *
 * But "it faulted" is still a fact both backends must agree on, and a fault in ONE of them is one of the most
 * valuable divergences there is — the runaway-loop bug was exactly that shape. So the comparison is between
 * outcomes: both faulted (agree — the messages differ by design and are not compared), neither faulted (compare
 * every value), or one did (a divergence, reported as one).
 */
type Outcome = { faulted: true } | { faulted: false; values: Map<string, string> }

function interpreterOutcome(c: Case): Outcome {
  const runner = run(c.pou)
  try {
    for (const p of c.paths) {
      const kind = seedable(p.type)
      if (kind === undefined) continue
      const n = seedFor(p.path)
      try {
        runner.set(p.path, kind === "bool" ? n % 2 === 1 : kind === "real" ? realSeedFor(p.path) : BigInt(n))
      } catch {
        // not settable through this path (an alias, a read-only place) — it is still read below
      }
    }
    for (let i = 0; i < c.cycles; i++) runner.scan()
  } catch {
    return { faulted: true }
  }
  const values = new Map<string, string>()
  for (const p of c.paths) {
    let v: unknown
    try {
      v = runner.get(p.path)
    } catch {
      continue
    }
    const wide = p.type.kind === "elementary" && p.type.elem.name === "LREAL"
    values.set(p.path, render(v, wide))
  }
  return { faulted: false, values }
}

function rustProgram(c: Case): string {
  const emitted = emitFor(c)
  const setup = [
    ...(emitted.usesGlobals ? ["    let mut g = Globals::new();"] : []),
    ...(emitted.usesPrograms ? ["    let mut prg = Programs::new();"] : []),
  ]
  const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : [])].join(", ")
  const seeds: string[] = []
  for (const p of c.paths) {
    const kind = seedable(p.type)
    if (kind === undefined) continue
    const n = seedFor(p.path)
    const root = p.global ? "g" : "p"
    const value =
      kind === "bool"
        ? n % 2 === 1
          ? "true"
          : "false"
        : kind === "real"
          ? // the SAME ladder value the interpreter is handed, printed so Rust reads it as the f64 it is
            `(${realSeedFor(p.path).toExponential()}f64) as _`
          : `${n} as _`
    seeds.push(`    ${root}.${p.expr} = ${value};`)
  }
  const prints = c.paths.map((p) => {
    const family = p.type.kind === "elementary" ? p.type.elem.family : undefined
    const root = p.global ? "g" : "p"
    // reals print their BITS, strings their units — see the header
    const field =
      family === "real" ? `${root}.${p.expr}.to_bits()` : `${root}.${p.expr}${family === "string" ? ".units()" : ""}`
    return `    println!("${p.path}\\t{${family === "string" ? ":?" : ""}}", ${field});`
  })
  // INIT BEFORE THE SEEDS, because `run(pou)` executes `pou.init` at CONSTRUCTION — before a caller can set
  // anything. Seeding first here and initialising after made the two backends run the same program in a
  // different order, and the `fb_init_*` fixtures (whose whole subject is init order) reported divergences that
  // were the harness's own doing.
  const init = c.pou.init === undefined ? [] : [`    p.init(${args});`]
  const body = [...setup, ...init, ...seeds, `    for _ in 0..${c.cycles} { p.scan(${args}); }`].join("\n")
  return `${emitted.code}\nfn main() {\n    let mut p = ${c.pou.name}::new();\n${body}\n${prints.join("\n")}\n}\n`
}

let emitCache: WeakMap<IrPou, ReturnType<typeof import("../../src/transpile/index.js").emitRust>> | undefined
function emitFor(c: Case): { code: string; usesGlobals?: boolean; usesPrograms?: boolean } {
  emitCache ??= new WeakMap()
  const hit = emitCache.get(c.pou)
  if (hit !== undefined) return hit
  // imported lazily so the module still loads where rustc is absent and the whole describe is skipped
  const { emitRust } = require("../../src/transpile/index.js") as typeof import("../../src/transpile/index.js")
  const made = emitRust(c.pou)
  emitCache.set(c.pou, made)
  return made
}

/**
 * THE PROBES — hand-written programs aimed at the shapes where the two backends are KNOWN to have diverged.
 *
 * The fixture sweep below is broad and shallow: 111 fixtures, ~229 places, and measured on the day it was
 * written it did **not** catch the MOD-shadowing divergence, because no fixture happens to declare a FUNCTION
 * with a parameter named `a` that takes a MOD. A sweep over programs written for another purpose finds what it
 * happens to touch.
 *
 * These are written for this purpose. Each one is a divergence that was real, so each is a regression test with
 * a date rather than a guess about what might break. They are also the seed of the generator D1 asks for: a
 * generator's value is that it reaches shapes nobody thought to write down, and these are the shapes we now know
 * to be worth reaching.
 */
const PROBES: ReadonlyArray<{ name: string; source: string; why: string }> = [
  {
    name: "probe_mod_parameter_shadow",
    why: "the MOD expansion bound `a`/`d` and shadowed a FUNCTION parameter — `7 MOD 3` compiled to `7 % 7` = 0",
    source:
      "FUNCTION F_pmod : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nF_pmod := b MOD a;\nEND_FUNCTION\n\n" +
      "PROGRAM PLC_PRG\nVAR\n\trv : INT;\n\tr2 : INT;\nEND_VAR\nrv := F_pmod(a := 3, b := 7);\nr2 := F_pmod(a := 5, b := 23);\nEND_PROGRAM\n",
  },
  {
    name: "probe_bit_assign_shadow",
    why: "the bit-assign expansion bound `v`/`w` and shadowed locals of those names",
    source:
      "FUNCTION F_pbit : WORD\nVAR_INPUT\n\tv : BOOL;\n\tw : WORD;\nEND_VAR\nw.3 := v;\nF_pbit := w;\nEND_FUNCTION\n\n" +
      "PROGRAM PLC_PRG\nVAR\n\tout : WORD;\nEND_VAR\nout := F_pbit(v := TRUE, w := 1);\nEND_PROGRAM\n",
  },
  {
    name: "probe_negative_zero",
    why: "unary negation of a REAL was `0 - x` in the interpreter, so `-0.0` came out `+0.0` — invisible under `==`",
    source: "PROGRAM PLC_PRG\nVAR\n\tz : REAL := 0.0;\n\tnz : REAL;\n\tlz : LREAL := 0.0;\n\tnlz : LREAL;\nEND_VAR\nnz := -(z - z);\nnlz := -(lz - lz);\nEND_PROGRAM\n",
  },
  {
    name: "probe_real_to_int_range",
    why: "`REAL → integer` saturates in Rust above the i64 range and wraps in the interpreter — 1.0E19 is barely past i64::MAX, 1.0E30 is far past it, and the two answer differently there",
    source:
      "PROGRAM PLC_PRG\nVAR\n\tbig : LREAL := 1.0E19;\n\tneg : LREAL := -1.0E19;\n\thuge : LREAL := 1.0E30;\n\tnhuge : LREAL := -1.0E30;\n\ta : DINT;\n\tb : DINT;\n\tc : LINT;\n\td : LINT;\n\te : DINT;\n\tf : DINT;\n\tg : LINT;\n\th : LINT;\nEND_VAR\n" +
      "a := LREAL_TO_DINT(big);\nb := LREAL_TO_DINT(neg);\nc := LREAL_TO_LINT(big);\nd := LREAL_TO_LINT(neg);\n" +
      "e := LREAL_TO_DINT(huge);\nf := LREAL_TO_DINT(nhuge);\ng := LREAL_TO_LINT(huge);\nh := LREAL_TO_LINT(nhuge);\nEND_PROGRAM\n",
  },
  {
    name: "probe_runaway_loop",
    why: "the interpreter capped a loop at a million iterations and threw; the emitted Rust had no cap and ran forever",
    source: "PROGRAM PLC_PRG\nVAR\n\tn : DINT;\n\tgo : BOOL := TRUE;\nEND_VAR\nWHILE go DO\n\tn := n + 1;\nEND_WHILE\nEND_PROGRAM\n",
  },
  {
    name: "probe_real_infinity_faults",
    why: "an infinite REAL STOPS the task on CODESYS (domain_ln_zero, domain_divide_real_by_zero) — the interpreter faults, and the emitted Rust must fault too rather than carrying an `inf` forward. Dividing by `zero - zero`, not `zero`: a seeded variable is not the zero this is about",
    source:
      "PROGRAM PLC_PRG\nVAR\n\tzero : LREAL;\n\tout : LREAL;\nEND_VAR\nout := 1.0 / (zero - zero);\nEND_PROGRAM\n",
  },
  {
    name: "probe_integer_edges",
    why: "wrapping at every width, in both directions — the arithmetic both backends must round-trip identically",
    source:
      "PROGRAM PLC_PRG\nVAR\n\tsi : SINT := 127;\n\tsi2 : SINT;\n\tii : INT := 32767;\n\tii2 : INT;\n\tdi : DINT := 2147483647;\n\tdi2 : DINT;\n" +
      "\tus : USINT := 255;\n\tus2 : USINT;\n\tw : WORD := 16#FFFF;\n\tw2 : WORD;\nEND_VAR\n" +
      "si2 := si + 1;\nii2 := ii + 1;\ndi2 := di + 1;\nus2 := us + 1;\nw2 := w + 1;\nEND_PROGRAM\n",
  },
]

/** A probe lowered into the same shape the fixture sweep uses. */
function prepareProbe(name: string, source: string): Case | undefined {
  const { pou } = lowerSource(source, "PLC_PRG", LIBRARIES)
  if (pou === undefined) return undefined
  const paths: Case["paths"] = []
  for (const slot of pou.slots) {
    try {
      const { expr, type, global } = rustAccess(pou, slot.name)
      paths.push({ path: slot.name, type, global, expr })
    } catch {
      // not addressable from outside — not this gate's business
    }
  }
  return paths.length === 0 ? undefined : { name, pou, paths, cycles: 1, transcendental: TRANSCENDENTAL.test(source) }
}

/** Run one case through both backends and return the divergences — the whole comparison, in one place. */
async function compareCase(c: Case, dir: string): Promise<{ divergences: string[]; compared: number; faultedBoth: boolean }> {
  const b = interpreterOutcome(c)
  const file = join(dir, `${c.name}.rs`)
  const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
  await Bun.write(file, rustProgram(c))
  const build = Bun.spawnSync([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], { stderr: "pipe" })
  if (build.exitCode !== 0) return { divergences: [], compared: 0, faultedBoth: false }
  // A TIMEOUT, because the failure this gate exists to catch can be a HANG. Without the shared iteration cap the
  // emitted Rust ran a runaway loop forever while the interpreter threw after a million iterations — and an
  // un-timed harness meets that by hanging, which in CI is indistinguishable from a slow suite and strictly
  // worse than a red test. A run that had to be killed is a fault, and it is a DIFFERENT outcome from the
  // interpreter's clean throw, so it is reported as the divergence it is.
  const ran = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe", timeout: 10_000 })
  const cFaulted = ran.exitCode !== 0 || ran.exitCode === null
  if (b.faulted !== cFaulted)
    return {
      divergences: [
        `${c.name}: ${b.faulted ? "the INTERPRETER faulted and the Rust ran" : "the RUST faulted and the interpreter ran"}`,
      ],
      compared: 0,
      faultedBoth: false,
    }
  if (b.faulted) return { divergences: [], compared: 0, faultedBoth: true }
  const divergences: string[] = []
  let compared = 0
  for (const line of ran.stdout.toString().split("\n")) {
    const tab = line.indexOf("\t")
    if (tab < 0) continue
    const path = line.slice(0, tab)
    const got = line.slice(tab + 1).trim()
    const want = b.values.get(path)
    if (want === undefined) continue
    compared++
    if (want !== got && !(c.transcendental && withinUlp(want, got))) divergences.push(`${c.name}: ${path} — interp ${want}, rust ${got}`)
  }
  return { divergences, compared, faultedBoth: false }
}

/**
 * Two renderings of a REAL that differ only in the last few bits — the tolerance a TRANSCENDENTAL gets, and nothing
 * else does. Both sides are the decimal of a 64-bit pattern (`bitsOf`), so "a few ULP" is a small difference in that
 * integer. Four, which covers the `EXPT` case at 1.0E19^8 and is far too tight to hide a real defect: `-0.0` and
 * `+0.0` are 2^63 apart, and the REAL-to-integer divergences this gate found were whole values apart.
 */
function withinUlp(a: string, b: string): boolean {
  if (!/^-?\d+$/.test(a) || !/^-?\d+$/.test(b)) return false
  const gap = BigInt(a) - BigInt(b)
  return (gap < 0n ? -gap : gap) <= 4n
}

describe.skipIf(skipRustSuite())("the probes — every divergence that was real, as a regression test", () => {
  test(
    "the two backends agree on each shape they are known to have disagreed on",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "volt-probe-"))
      const divergences: string[] = []
      const unreached: string[] = []
      let compared = 0
      try {
        for (const probe of PROBES) {
          const c = prepareProbe(probe.name, probe.source)
          if (c === undefined) {
            // a probe that does not lower proves nothing and must not pass quietly
            unreached.push(`${probe.name} (does not lower) — ${probe.why}`)
            continue
          }
          const r = await compareCase(c, dir)
          divergences.push(...r.divergences)
          compared += r.compared
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      // eslint-disable-next-line no-console
      console.log(`  [probes] ${compared} places compared across ${PROBES.length} probes`)
      expect(unreached).toEqual([])
      expect(divergences).toEqual([])
      expect(compared).toBeGreaterThan(0)
    },
    300_000,
  )
})

describe.skipIf(skipRustSuite())("the two backends agree with each other, without CODESYS", () => {
  test(
    "every place the enumerator names holds the same value in the interpreter and the emitted Rust",
    async () => {
      const all = ALL_TESTS.filter((t) => t.source !== "" && !t.recorderSkip)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
      const step = Math.max(1, Math.ceil(all.length / SAMPLE))
      const sampled = all.filter((_, i) => i % step === 0)
      // NO SILENT CAP — say what was left out and how to widen it
      // eslint-disable-next-line no-console
      console.log(`  [b<->c] ${sampled.length} of ${all.length} fixtures sampled (every ${step}); raise SAMPLE to widen`)

      const dir = await mkdtemp(join(tmpdir(), "volt-bc-"))
      const divergences: string[] = []
      let compared = 0
      let agreedFaults = 0
      try {
        for (const t of sampled) {
          const c = prepare(t)
          if (c === undefined) continue
          const b = interpreterOutcome(c)
          const file = join(dir, `${c.name}.rs`)
          const exe = join(dir, `${c.name}${process.platform === "win32" ? ".exe" : ""}`)
          await Bun.write(file, rustProgram(c))
          const build = Bun.spawnSync([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], { stderr: "pipe" })
          // a case that does not COMPILE is the compile gate's business, not this one
          if (build.exitCode !== 0) continue
          const ran = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe" })
          const cFaulted = ran.exitCode !== 0
          if (b.faulted !== cFaulted) {
            divergences.push(
              `${c.name}: ${b.faulted ? "the INTERPRETER faulted and the Rust ran" : "the RUST faulted and the interpreter ran"}` +
                ` — ${(cFaulted ? ran.stderr.toString() : "").split("\n")[0]?.trim() ?? ""}`,
            )
            continue
          }
          if (b.faulted) {
            agreedFaults++
            continue // both refused the same program; the wording is each backend's own
          }
          for (const line of ran.stdout.toString().split("\n")) {
            const tab = line.indexOf("\t")
            if (tab < 0) continue
            const path = line.slice(0, tab)
            const got = line.slice(tab + 1).trim()
            const want = b.values.get(path)
            if (want === undefined) continue
            compared++
            // the same rule the probe comparison applies — a transcendental's last bits are two libms', not a defect
            if (want !== got && !(c.transcendental && withinUlp(want, got)))
              divergences.push(`${c.name}: ${path} — interp ${want}, rust ${got}`)
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      // eslint-disable-next-line no-console
      console.log(`  [b<->c] ${compared} places compared, ${agreedFaults} case(s) where both backends faulted`)
      expect(compared).toBeGreaterThan(0) // a gate that compared nothing has not passed, it has abstained
      expect(divergences).toEqual([])
    },
    600_000,
  )
})
