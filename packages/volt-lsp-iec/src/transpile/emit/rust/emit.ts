/**
 * IR → Rust. A syntax-directed printer, and nothing more.
 *
 * Every semantic question was answered in lowering: types are resolved, conversions are explicit nodes, CASE
 * labels are constant ranges, all three loop forms are one shape. **If this file ever has to decide
 * something, the lowering is incomplete and that is the bug** — the rule that keeps the backend reviewable
 * and keeps a second target (C, LLVM) cheap.
 *
 * Two things are not cosmetic:
 *
 * **No Rust references.** A POU is one flat `struct` of slots, and its body is `fn scan(&mut self)`. When
 * pointers and VAR_IN_OUT arrive they become slot INDICES into that same struct, never `&mut` — see
 * `ir.ts` for why borrowck is a fight this design declines to have.
 *
 * **Deterministic numerics.** IEC integers wrap at their declared width, so arithmetic emits `wrapping_*`
 * rather than Rust's overflow-panicking defaults. The width comes from `types/elementary`, the same facts the
 * diagnostics use — there is no second table of type sizes here.
 */
import type { IrExpr, IrLayout, IrMathName, IrPou, IrRoutine, IrStmt, IrValue, Place } from "../../ir/index.js"
import { defaultValueOf, isBit, peelArray } from "../../ir/index.js"
import type { Span } from "../../../syntax/index.js"
import type { Type } from "../../../types/index.js"
import { STRING_PRELUDE } from "./prelude.js"

/** Emitted Rust, plus the line→ST mapping a panic or a failed assertion is reported through. */
export interface Emitted {
  code: string
  /** 1-based emitted line → the ST span it came from. */
  sourceMap: readonly { line: number; span: Span }[]
  /** The program reaches GVL variables: `scan` takes `g: &mut Globals` (`Globals::new()` builds it). */
  usesGlobals: boolean
  /** The program calls PROGRAMs: `scan` takes `prg: &mut Programs` (`Programs::new()`), after `g`. */
  usesPrograms: boolean
}

/** IEC elementary type → Rust type, derived from the type's own facts (family · bits · signed). */
export function rustType(t: Type): string {
  // a struct or FB instance is its layout's struct, held by value; an array is a Rust array, one per dimension
  if (t.kind === "struct" || t.kind === "function_block") return rustName(t.name)
  const array = peelArray(t)
  if (array !== undefined) return `[${rustType(array.element)}; ${array.length}]`
  if (t.kind !== "elementary") throw new Error(`no Rust mapping for a ${t.kind} type`)
  const { family, bits, signed } = t.elem
  if (family === "bool" || isBit(t)) return "bool"
  if (family === "real") return bits === 32 ? "f32" : "f64"
  // A fixed-capacity string, generated into the output (STRING_PRELUDE) — not Rust `String`, which neither truncates
  // nor copies: `a := b` MOVED a String out of `self`, and no emitted program had ever held a string to find out.
  if (family === "string") {
    const s = stringType(t)
    return `${s.name}<${s.capacity}>`
  }
  // A duration or date is the integer it is measured to be: TIME/TOD a u32 of MILLISECONDS, DATE/DT a u32 of SECONDS,
  // LTIME/LDATE/LDT/LTOD a u64 of nanoseconds (design §16, §17). This used to print every one of them as an i64.
  if (family === "int" || family === "bitstring" || family === "time" || family === "date") return `${signed ? "i" : "u"}${bits}`
  throw new Error(`no Rust mapping for ${t.name}`)
}

/** A POU's or DUT's Rust struct name: the ST name as written, so a reader finds `FB_Conveyor` under its own name
 *  (the structs carry `#[allow(non_camel_case_types)]`). */
export function rustName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_")
}

/** The Rust expression a variable of `t` starts at: a literal, a layout's `new()`, or an array of fresh elements. */
function initOf(t: Type, init: IrValue): string {
  if (t.kind === "struct" || t.kind === "function_block") return `${rustName(t.name)}::new()`
  const array = peelArray(t)
  if (array === undefined) return literal(init, t)
  const element = initOf(array.element, defaultValueOf(array.element))
  return array.element.kind === "elementary" ? `[${element}; ${array.length}]` : `std::array::from_fn(|_| ${element})`
}

/** ST names are PascalCase/mixed; Rust fields are snake_case. Mechanical, and stable across runs. */
export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
}

/** Rust's keywords (strict and reserved, 2021) — a field named one does not compile. */
const RUST_KEYWORDS: ReadonlySet<string> = new Set(
  (
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub " +
    "ref return self static struct super trait true type unsafe use where while abstract become box do final macro " +
    "override priv try typeof unsized virtual yield"
  ).split(" "),
)

/**
 * Each slot's Rust field name, in frame order: snake_case, a Rust keyword suffixed `_`, and unique within the POU. The
 * bare `snake` was the field name, so a variable named `loop` emitted `pub loop: i16` and `aB` beside `a_b` emitted
 * two `a_b` fields — neither compiles, and no oracle case held such a name (transpiler review 2026-09-14).
 */
export function fieldNames(slots: IrPou["slots"], reserved: readonly string[] = []): string[] {
  const used = new Set<string>(reserved)
  return slots.map((slot) => {
    const snaked = snake(slot.name)
    const base = RUST_KEYWORDS.has(snaked) ? `${snaked}_` : snaked
    let name = base
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`
    used.add(name)
    return name
  })
}

/** A string type's generated Rust type (STRING_PRELUDE) and capacity — the one place both are read off the type. */
function stringType(t: Type): { name: "IecString" | "IecWString"; capacity: number } {
  if (t.kind !== "elementary" || t.length === undefined) throw new Error("no Rust mapping for a string type without a capacity")
  return { name: t.name === "WSTRING" ? "IecWString" : "IecString", capacity: t.length }
}

/** A STRING's bytes as a Rust byte-string literal: printable ASCII as itself, every other byte as `\xNN`. */
function byteString(text: string): string {
  let out = ""
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    out += code >= 0x20 && code < 0x7f && ch !== '"' && ch !== "\\" ? ch : `\\x${code.toString(16).padStart(2, "0")}`
  }
  return `b"${out}"`
}

/** A string type's `IecString::<N>` / `IecWString::<N>` — the path its constructors are called through. */
function stringPath(t: Type): string {
  const s = stringType(t)
  return `${s.name}::<${s.capacity}>`
}

/** A string literal as the units of its type: bytes for a STRING, UTF-16 units for a WSTRING. */
function unitsLiteral(text: string, t: Type): string {
  // code UNITS, not code points — `split("")` walks UTF-16 units, as the interpreter's string does
  if (t.kind === "elementary" && t.name === "WSTRING") return `&[${text.split("").map((ch) => `${ch.charCodeAt(0)}u16`).join(", ")}]`
  return byteString(text)
}

function literal(v: IrValue, t: Type): string {
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "string") return `${stringPath(t)}::lit(${unitsLiteral(v, t)})`
  return `${v}${t.kind === "elementary" ? rustType(t) : ""}`.replace(/^(-?\d+)(f\d\d)$/, "$1.0$2")
}

/** The one-argument math functions → their `f64` method. LOG is base 10 in IEC. */
const RUST_MATH: Readonly<Record<IrMathName, string>> = {
  sqrt: "sqrt",
  ln: "ln",
  log: "log10",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
}

/** `wrapping_add` and friends — IEC integers wrap at their width; Rust's `+` would panic in debug. */
const WRAPPING: Readonly<Record<string, string>> = { add: "add", sub: "sub", mul: "mul", div: "div", mod: "rem" }
const INFIX: Readonly<Record<string, string>> = {
  eq: "==",
  ne: "!=",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  and_then: "&&",
  or_else: "||",
}

class Printer {
  private readonly lines: string[] = []
  readonly sourceMap: { line: number; span: Span }[] = []

  /** The enclosing IR loops, innermost last — each one's number names its `'loop_N` and `'body_N` labels, and the flags
   *  say whether an EXIT or a CONTINUE used them (an unused label is a rustc warning, and the crate builds with none). */
  private readonly loops: { n: number; exits: boolean; continues: boolean }[] = []
  private loopCount = 0

  /** The body being printed: its VAR_IN_OUT parameters and its routine's locals (Rust names and slots), and the name of
   *  the result local a `return` hands back. */
  private frame: Frame = { inoutNames: [], inoutSlots: [], localNames: [], localSlots: [] }

  constructor(
    private fields: readonly string[],
    private readonly layouts: ReadonlyMap<string, { layout: IrLayout; fields: readonly string[] }>,
    private readonly routines: ReadonlyMap<string, IrRoutine>,
    /** Each global slot's Rust access (`g.g_shared`, `prg.prg_writer`), and the slots — `IrPou.globals`' order. */
    private readonly globals: { access: readonly string[]; slots: IrPou["slots"] },
    /** The program reaches GVL variables — every generated call is handed `g`. */
    private readonly usesGlobals: boolean,
  ) {}

  /** `g` before a generated call's arguments when the program has GVL variables. */
  get globalsArg(): string[] {
    return this.usesGlobals ? ["g"] : []
  }

  /** Print `run` inside an FB's `call` or a routine: `fields` are `self`'s, the frame holds its parameters and locals. */
  inFrame(fields: readonly string[], frame: Frame, run: () => void): void {
    const saved = [this.fields, this.frame] as const
    ;[this.fields, this.frame] = [fields, frame]
    run()
    ;[this.fields, this.frame] = saved
  }

  /** A place as a Rust lvalue — `self.inst.q`, `self.arr[(self.i as i64 - 1i64) as usize].x`, `(*v)`, `count` — without a final bit step. */
  place(p: Place, slots: IrPou["slots"]): string {
    let text =
      p.root === "inout"
        ? `(*${this.frame.inoutNames[p.slot]})`
        : p.root === "local"
          ? this.frame.localNames[p.slot]!
          : p.root === "global"
            ? this.globals.access[p.slot]!
            : `self.${this.fields[p.slot]}`
    let type: Type =
      p.root === "inout"
        ? this.frame.inoutSlots[p.slot]!.type
        : p.root === "local"
          ? this.frame.localSlots[p.slot]!.type
          : p.root === "global"
            ? this.globals.slots[p.slot]!.type
            : slots[p.slot]!.type
    for (const step of p.path) {
      if (step.kind === "field") {
        const entry = type.kind === "struct" || type.kind === "function_block" ? this.layouts.get(type.name.toUpperCase()) : undefined
        const i = entry?.layout.fields.findIndex((f) => f.name.toUpperCase() === step.name.toUpperCase()) ?? -1
        if (entry === undefined || i < 0) throw new Error(`no field ${step.name} in ${type.kind}`)
        text += `.${entry.fields[i]}`
        type = entry.layout.fields[i]!.type
      } else if (step.kind === "index") {
        const index = this.expr(step.index, slots)
        // a negative offset wraps to a huge usize, so an index below the lower bound panics like one above the upper
        text += step.lower === 0n ? `[(${index} as i64) as usize]` : `[((${index} as i64) - ${step.lower}i64) as usize]`
        type = peelArray(type)!.element
      }
    }
    return text
  }

  push(text: string, indent: number, span?: Span): void {
    this.lines.push(`${"    ".repeat(indent)}${text}`)
    if (span !== undefined) this.sourceMap.push({ line: this.lines.length, span })
  }

  get code(): string {
    return `${this.lines.join("\n")}\n`
  }

  expr(e: IrExpr, slots: IrPou["slots"]): string {
    switch (e.kind) {
      case "const":
        return literal(e.value, e.type)
      case "invoke": {
        // the inputs by value, then the VAR_IN_OUT as `&mut` — a METHOD or ACTION on its instance, a FUNCTION free
        const routine = this.routines.get(e.routine)!
        const args = [...this.globalsArg, ...e.inputs.map((a) => this.expr(a, slots)), ...e.inouts.map((p) => `&mut ${this.place(p, slots)}`)].join(", ")
        const fn = routineFnName(routine)
        return e.instance === undefined ? `${fn}(${args})` : `${this.place(e.instance, slots)}.${fn}(${args})`
      }
      case "load": {
        const field = this.place(e.place, slots)
        const bit = e.place.path.at(-1)
        if (bit?.kind === "bit") return `(((${field} >> ${bit.index}) & 1) != 0)`
        // a whole struct, instance or array is copied, never moved out of `self`
        return e.type.kind === "elementary" ? field : `${field}.clone()`
      }
      case "convert": {
        // The measured rules (design §11), each where Rust's bare `as` means something else: a float → int `as`
        // TRUNCATES and SATURATES, where CODESYS rounds half away from zero (`f64::round` is exactly that) and wraps
        // (through i64, then `as` between ints wraps); `as bool` does not exist; nor does `bool as f32`.
        const value = this.expr(e.value, slots)
        const from = e.value.type.kind === "elementary" ? e.value.type.elem.family : undefined
        const to = e.type.kind === "elementary" ? e.type.elem.family : undefined
        const target = rustType(e.type)
        // STRING → STRING of another capacity: the copy that truncates (never across widths — that does not compile)
        if (to === "string" && from === "string") return `${value}.to::<${stringType(e.type).capacity}>()`
        if (to === "string") {
          const source = e.value.type.kind === "elementary" ? e.value.type.name : ""
          const text =
            from === "bool" ? `(if ${value} { "TRUE" } else { "FALSE" })` : source === "TIME" ? `iec_time_text(${value} as i64)` : `format!("{}", ${value})`
          return `${stringPath(e.type)}::lit(${text}.as_bytes())`
        }
        if (from === "string") return `(iec_parse_${to === "real" ? "real" : "int"}(${value}.units()) as ${target})`
        if (to === "bool") return from === "bool" ? value : from === "real" ? `(${value} != 0.0)` : `(${value} != 0)`
        if (from === "bool") return to === "real" ? `((${value} as u8) as ${target})` : `(${value} as ${target})`
        if (from === "real" && to !== "real") return `((${value}.round() as i64) as ${target})`
        return `(${value} as ${target})`
      }
      case "builtin": {
        const args = e.args.map((a) => this.expr(a, slots))
        switch (e.name) {
          case "max":
          case "min":
            return args.reduce((acc, a) => `${acc}.${e.name}(${a})`)
          // NOT `clamp`: Rust's panics when MN > MX, and CODESYS answers that case with MX for every IN (conformance
          // `limit_inverted_bounds`). MIN(MAX(IN, MN), MX) is exactly the measured behaviour.
          case "limit":
            return `${args[1]}.max(${args[0]}).min(${args[2]})`
          case "sel":
            return `(if ${args[0]} { ${args[2]} } else { ${args[1]} })`
          // Toward zero into an i32 whose out-of-range (and NaN) answer is i32::MIN — CODESYS's TRUNC(3.0E9) is
          // -2147483648, not a wrap and not Rust's saturating `as` — then `as` wraps that into INT for TRUNC_INT.
          case "trunc":
            return `({ let t = (${args[0]} as f64).trunc(); if t >= -2147483648.0 && t <= 2147483647.0 { t as i32 } else { i32::MIN } } as ${rustType(e.type)})`
          // Rust's own features, each proven to match at the edges (design §13, §14): `wrapping_shl`/`wrapping_shr`
          // mask the count to the width's bits exactly as CODESYS does and shift a signed value arithmetically;
          // `rotate_left`/`rotate_right` take the count modulo the width.
          case "shl":
            return `${args[0]}.wrapping_shl((${args[1]} as u32))`
          case "shr":
            return `${args[0]}.wrapping_shr((${args[1]} as u32))`
          case "rol":
            return `${args[0]}.rotate_left((${args[1]} as u32))`
          case "ror":
            return `${args[0]}.rotate_right((${args[1]} as u32))`
          case "mux": {
            const [k, ...inputs] = args
            const arms = inputs.map((input, i) => (i === inputs.length - 1 ? `_ => ${input}` : `${i} => ${input}`))
            return `(match ${k} { ${arms.join(", ")} })`
          }
          case "expt":
            return `((${args[0]} as f64).powf(${args[1]} as f64) as ${rustType(e.type)})`
          case "abs": {
            // `abs` would panic on a signed minimum in a debug build; an unsigned type has no `abs` at all
            const t = e.type.kind === "elementary" ? e.type.elem : undefined
            return t?.family === "real" ? `${args[0]}.abs()` : t?.signed ? `${args[0]}.wrapping_abs()` : args[0]!
          }
          case "len":
          case "left":
          case "right":
          case "mid":
          case "concat":
          case "insert":
          case "delete":
          case "replace":
          case "find": {
            // a STRING argument passes its bytes, an integer one widens to the helpers' i64
            const passed = e.args.map((a, i) =>
              a.type.kind === "elementary" && a.type.elem.family === "string" ? `${args[i]}.units()` : `(${args[i]} as i64)`,
            )
            const call = `iec_${e.name}(${passed.join(", ")})`
            return e.name === "len" || e.name === "find" ? `(${call} as ${rustType(e.type)})` : `${stringPath(e.type)}::lit(&${call})`
          }
          case "sqrt":
          case "ln":
          case "log":
          case "exp":
          case "sin":
          case "cos":
          case "tan":
          case "asin":
          case "acos":
          case "atan":
            // through f64 and back, the same path the interpreter takes — `f32::ln` is a different float32 routine
            return `((${args[0]} as f64).${RUST_MATH[e.name]}() as ${rustType(e.type)})`
        }
      }
      case "unary": {
        const operand = this.expr(e.operand, slots)
        if (e.op === "not") return `(!${operand})`
        // An integer's minimum has no positive counterpart in its own width, and Rust's `-` PANICS on it in a debug
        // build — found by the differential test (conformance `unary_minus_at_the_edge`, a DINT at its minimum).
        const isReal = e.type.kind === "elementary" && e.type.elem.family === "real"
        return isReal ? `(-${operand})` : `${operand}.wrapping_neg()`
      }
      case "binary": {
        const l = this.expr(e.left, slots)
        const r = this.expr(e.right, slots)
        const infix = INFIX[e.op]
        if (infix !== undefined) return `(${l} ${infix} ${r})`
        const isBool = e.type.kind === "elementary" && e.type.elem.family === "bool"
        if (e.op === "and" || e.op === "or" || e.op === "xor") {
          const op = e.op === "and" ? "&" : e.op === "or" ? "|" : "^"
          return `(${l} ${isBool && op !== "^" ? op.repeat(2) : op} ${r})`
        }
        const wrapping = WRAPPING[e.op]
        const isReal = e.type.kind === "elementary" && e.type.elem.family === "real"
        if (wrapping !== undefined && !isReal) return `${l}.wrapping_${wrapping}(${r})`
        const plain = e.op === "add" ? "+" : e.op === "sub" ? "-" : e.op === "mul" ? "*" : e.op === "div" ? "/" : "%"
        return `(${l} ${plain} ${r})`
      }
    }
  }

  block(list: readonly IrStmt[], slots: IrPou["slots"], indent: number): void {
    if (list.length === 0) {
      this.push("// (empty)", indent)
      return
    }
    for (const s of list) this.stmt(s, slots, indent)
  }

  stmt(s: IrStmt, slots: IrPou["slots"], indent: number): void {
    switch (s.kind) {
      case "assign": {
        const field = this.place(s.target, slots)
        const bit = s.target.path.at(-1)
        if (bit?.kind !== "bit") {
          this.push(`${field} = ${this.expr(s.value, slots)};`, indent, s.span)
          return
        }
        // a typed one — `1i16 << 15` is -32768, exactly the two's complement bit the IDE sets
        const one = `(1${rustType(bit.of)} << ${bit.index})`
        this.push(`${field} = if ${this.expr(s.value, slots)} { ${field} | ${one} } else { ${field} & !${one} };`, indent, s.span)
        return
      }
      case "if": {
        this.push(`if ${this.expr(s.cond, slots)} {`, indent, s.span)
        this.block(s.then, slots, indent + 1)
        if (s.else.length > 0) {
          this.push("} else {", indent)
          this.block(s.else, slots, indent + 1)
        }
        this.push("}", indent)
        return
      }
      case "switch": {
        this.push(`match ${this.expr(s.selector, slots)} {`, indent, s.span)
        for (const arm of s.arms) {
          const pattern = arm.labels
            .map((l) => (l.lo === l.hi ? `${l.lo}` : `${l.lo}..=${l.hi}`))
            .join(" | ")
          this.push(`${pattern} => {`, indent + 1, arm.span)
          this.block(arm.body, slots, indent + 2)
          this.push("}", indent + 1)
        }
        this.push("_ => {", indent + 1)
        this.block(s.else, slots, indent + 2)
        this.push("}", indent + 1)
        this.push("}", indent)
        return
      }
      case "loop": {
        // One IR shape → one Rust shape: `loop` with the test placed at the head or the tail. The body sits in a labeled
        // block, and an IR `continue` leaves THAT block, so the step and a tail test still run — as CODESYS runs them: a
        // CONTINUE in FOR still steps and in REPEAT still tests UNTIL (conformance `continue_in_*`). It printed a bare Rust
        // `continue`, which skipped both and looped forever (transpiler review 2026-09-14). EXIT names the loop, since an
        // unlabeled `break` may not sit directly in a labeled block.
        const frame = { n: ++this.loopCount, exits: false, continues: false }
        for (const init of s.init) this.stmt(init, slots, indent)
        const loopLine = this.lines.length
        this.push(`'loop_${frame.n}: loop {`, indent, s.span)
        if (s.test !== undefined && !s.test.atEnd)
          this.push(`if !${this.expr(s.test.cond, slots)} { break; }`, indent + 1)
        const bodyLine = this.lines.length
        this.push(`'body_${frame.n}: {`, indent + 1)
        this.loops.push(frame)
        this.block(s.body, slots, indent + 2)
        this.loops.pop()
        this.push("}", indent + 1)
        if (!frame.exits) this.lines[loopLine] = this.lines[loopLine]!.replace(`'loop_${frame.n}: `, "")
        if (!frame.continues) this.lines[bodyLine] = this.lines[bodyLine]!.replace(`'body_${frame.n}: `, "")
        for (const step of s.step) this.stmt(step, slots, indent + 1)
        if (s.test !== undefined && s.test.atEnd)
          this.push(`if !${this.expr(s.test.cond, slots)} { break; }`, indent + 1)
        this.push("}", indent)
        return
      }
      case "break": {
        const frame = this.loops.at(-1)
        if (frame !== undefined) frame.exits = true
        this.push(frame === undefined ? "break;" : `break 'loop_${frame.n};`, indent, s.span)
        return
      }
      case "continue": {
        const frame = this.loops.at(-1)
        if (frame !== undefined) frame.continues = true
        this.push(frame === undefined ? "continue;" : `break 'body_${frame.n};`, indent, s.span)
        return
      }
      case "return":
        this.push(this.frame.result === undefined ? "return;" : `return ${this.frame.result};`, indent, s.span)
        return
      case "eval":
        this.push(`${this.expr(s.value, slots)};`, indent, s.span)
        return
      case "call": {
        // the inputs were assigned before this line and the outputs are read after it; VAR_IN_OUT is a `&mut` (design §9)
        const bound = [...this.globalsArg, ...s.inouts.map((p) => `&mut ${this.place(p, slots)}`)].join(", ")
        this.push(`${this.place(s.instance, slots)}.call(${bound});`, indent, s.span)
        return
      }
    }
  }
}

/** What a body is printed against: its VAR_IN_OUT parameters, its routine's locals, and its result local. */
interface Frame {
  inoutNames: readonly string[]
  inoutSlots: IrPou["slots"]
  localNames: readonly string[]
  localSlots: IrPou["slots"]
  result?: string
}

/** A routine's Rust fn name: snake_case, a keyword or a name the emitter generates itself (`new`, `call`, `scan`) suffixed `_`. */
function routineFnName(routine: IrRoutine): string {
  const snaked = snake(routine.name.slice(routine.name.lastIndexOf(".") + 1))
  return RUST_KEYWORDS.has(snaked) || ["new", "call", "scan"].includes(snaked) ? `${snaked}_` : snaked
}

/**
 * A METHOD or ACTION as an `fn` in its FB's `impl`, or a FUNCTION as a free `fn`: the inputs are parameters, the VAR_IN_OUT
 * `&mut` parameters, every other local a `let mut` at its initial value — so each call starts over, as measured — and the
 * result local is handed back.
 */
function printRoutine(p: Printer, routine: IrRoutine, fields: readonly string[], fieldSlots: IrPou["slots"], indent: number, usesGlobals: boolean): void {
  const names = fieldNames([...routine.locals, ...routine.inouts], usesGlobals ? ["g"] : [])
  const localNames = names.slice(0, routine.locals.length)
  const inoutNames = names.slice(routine.locals.length)
  const params = [
    ...(routine.kind === "function" ? [] : ["&mut self"]),
    ...(usesGlobals ? ["g: &mut Globals"] : []),
    ...routine.inputs.map((i) => `mut ${localNames[i]}: ${rustType(routine.locals[i]!.type)}`),
    ...routine.inouts.map((slot, i) => `${inoutNames[i]}: &mut ${rustType(slot.type)}`),
  ]
  const result = routine.result === undefined ? undefined : localNames[routine.result]!
  const returns = routine.result === undefined ? "" : ` -> ${rustType(routine.locals[routine.result]!.type)}`
  p.push("", 0)
  // generated locals may go unread or unwritten, and a body that ends in `return` leaves the tail unreachable
  p.push("#[allow(unused_mut, unused_variables, unused_assignments, unreachable_code, non_snake_case)]", indent)
  p.push(`pub fn ${routineFnName(routine)}(${params.join(", ")})${returns} {`, indent)
  for (const [i, slot] of routine.locals.entries())
    if (!routine.inputs.includes(i)) p.push(`let mut ${localNames[i]}: ${rustType(slot.type)} = ${initOf(slot.type, slot.init)};`, indent + 1)
  const frame: Frame = { inoutNames, inoutSlots: routine.inouts, localNames, localSlots: routine.locals, ...(result === undefined ? {} : { result }) }
  p.inFrame(fields, frame, () => p.block(routine.body, fieldSlots, indent + 1))
  if (result !== undefined) p.push(result, indent + 1)
  p.push("}", indent)
}

/**
 * A variable path as the IDE names it (`inst.q`, `arr[2].x`) → the Rust field access under a POU value, and the
 * variable's type — how a test reads the emitted program exactly where the interpreter's `get` reads.
 */
export function rustAccess(pou: IrPou, path: string): { expr: string; type: Type } {
  const parts = [...path.matchAll(/(`[^`]+`|[A-Za-z_]\w*)|\[\s*(-?\d+)\s*\]/g)]
  const bare = (n: string | undefined): string | undefined => n?.replace(/^`|`$/g, "").toUpperCase()
  const slot = pou.slots.findIndex((s) => bare(s.name) === bare(parts[0]?.[1]))
  if (slot < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let expr = fieldNames(pou.slots)[slot]!
  let type = pou.slots[slot]!.type
  for (const part of parts.slice(1)) {
    if (part[1] !== undefined) {
      const typeName = type.kind === "struct" || type.kind === "function_block" ? type.name.toUpperCase() : undefined
      const layout = pou.layouts.find((l) => l.name.toUpperCase() === typeName)
      const i = layout?.fields.findIndex((f) => bare(f.name) === bare(part[1])) ?? -1
      if (layout === undefined || i < 0) throw new Error(`no variable ${path} in ${pou.name}`)
      expr += `.${fieldNames(layout.fields)[i]}`
      type = layout.fields[i]!.type
    } else {
      const array = peelArray(type)
      if (array === undefined) throw new Error(`${path} indexes a non-array`)
      expr += `[${BigInt(part[2]!) - array.lower}]`
      type = array.element
    }
  }
  return { expr, type }
}

/** Emit one lowered POU as a Rust struct with a `scan` method. */
export function emitRust(pou: IrPou): Emitted {
  const layouts = new Map(pou.layouts.map((l) => [l.name.toUpperCase(), { layout: l, fields: fieldNames(l.fields) }]))
  const fields = fieldNames(pou.slots)
  // The application's global storage, as two structs so a call borrows two things: the GVL variables (`Globals`, handed
  // to every body as `g`) and each called PROGRAM's one instance (`Programs`, the POU's own `scan` only) — design §9.
  const variables = pou.globals.filter((s) => s.section !== "program")
  const programs = pou.globals.filter((s) => s.section === "program")
  const usesGlobals = variables.length > 0
  const usesPrograms = programs.length > 0
  const variableNames = fieldNames(variables)
  const programNames = fieldNames(programs)
  const access = pou.globals.map((s) =>
    s.section === "program" ? `prg.${programNames[programs.indexOf(s)]}` : `g.${variableNames[variables.indexOf(s)]}`,
  )
  const p = new Printer(fields, layouts, new Map(pou.routines.map((r) => [r.key, r])), { access, slots: pou.globals }, usesGlobals)
  const name = rustName(pou.name)
  // every generated body is handed the globals as `g`, so no parameter or local of its own may take that name
  const globalsParam = usesGlobals ? ["g: &mut Globals"] : []
  const reserved = usesGlobals ? ["g"] : []

  p.push(`// generated from ${pou.name} — do not edit`, 0)
  for (const [struct, slots, names] of [
    ["Globals", variables, variableNames],
    ["Programs", programs, programNames],
  ] as const) {
    if (slots.length === 0) continue
    p.push("#[allow(non_camel_case_types)]", 0)
    p.push("#[derive(Debug, Clone, PartialEq)]", 0)
    p.push(`pub struct ${struct} {`, 0)
    for (const [i, slot] of slots.entries()) p.push(`pub ${names[i]}: ${rustType(slot.type)},`, 1)
    p.push("}", 0)
    p.push("", 0)
    p.push(`impl ${struct} {`, 0)
    p.push("pub fn new() -> Self {", 1)
    p.push("Self {", 2)
    for (const [i, slot] of slots.entries()) p.push(`${names[i]}: ${initOf(slot.type, slot.init)},`, 3)
    p.push("}", 2)
    p.push("}", 1)
    p.push("}", 0)
    p.push("", 0)
  }
  // One plain struct per DUT and FB the frame holds, each with a `new` at its declared initial values. No `Default`
  // derive — Rust derives it only for arrays up to 32 elements — so every value starts through `new`.
  // ponytail: the layouts ride with each POU, like the string prelude; hoist them when whole projects are emitted.
  for (const { layout, fields: names } of layouts.values()) {
    p.push("#[allow(non_camel_case_types)]", 0)
    p.push("#[derive(Debug, Clone, PartialEq)]", 0)
    p.push(`pub struct ${rustName(layout.name)} {`, 0)
    for (const [i, field] of layout.fields.entries()) p.push(`pub ${names[i]}: ${rustType(field.type)},`, 1)
    p.push("}", 0)
    p.push("", 0)
    p.push(`impl ${rustName(layout.name)} {`, 0)
    p.push("pub fn new() -> Self {", 1)
    p.push("Self {", 2)
    for (const [i, field] of layout.fields.entries()) p.push(`${names[i]}: ${initOf(field.type, field.init)},`, 3)
    p.push("}", 2)
    p.push("}", 1)
    if (layout.body !== undefined) {
      const inouts = layout.inouts ?? []
      const inoutNames = fieldNames(inouts, reserved)
      const params = [...globalsParam, ...inouts.map((slot, i) => `${inoutNames[i]}: &mut ${rustType(slot.type)}`)].map((param) => `, ${param}`).join("")
      p.push("", 0)
      if (usesGlobals) p.push("#[allow(unused_variables)]", 1)
      p.push(`pub fn call(&mut self${params}) {`, 1)
      p.inFrame(names, { inoutNames, inoutSlots: inouts, localNames: [], localSlots: [] }, () => p.block(layout.body!, layout.fields, 2))
      p.push("}", 1)
    }
    for (const routine of pou.routines.filter((r) => r.fb?.toUpperCase() === layout.name.toUpperCase())) printRoutine(p, routine, names, layout.fields, 1, usesGlobals)
    p.push("}", 0)
    p.push("", 0)
  }
  p.push("#[allow(non_camel_case_types)]", 0)
  p.push("#[derive(Debug, Clone, PartialEq)]", 0)
  p.push(`pub struct ${name} {`, 0, pou.span)
  for (const [i, slot] of pou.slots.entries()) p.push(`pub ${fields[i]}: ${rustType(slot.type)},`, 1)
  p.push("}", 0)
  p.push("", 0)
  p.push(`impl ${name} {`, 0)

  // `new` seeds the declared initial values.
  p.push("pub fn new() -> Self {", 1)
  p.push("Self {", 2)
  for (const [i, slot] of pou.slots.entries()) p.push(`${fields[i]}: ${initOf(slot.type, slot.init)},`, 3)
  p.push("}", 2)
  p.push("}", 1)
  p.push("", 0)
  p.push(`pub fn scan(&mut self${usesGlobals ? ", g: &mut Globals" : ""}${usesPrograms ? ", prg: &mut Programs" : ""}) {`, 1)
  p.block(pou.body, pou.slots, 2)
  p.push("}", 1)
  p.push("}", 0)
  // a FUNCTION has no instance: a free fn beside the structs
  for (const routine of pou.routines.filter((r) => r.kind === "function")) printRoutine(p, routine, [], [], 0, usesGlobals)

  // Only a program that holds a string gets the string type — every other output stays exactly what it was.
  // ponytail: the prelude rides with each POU, so a crate of TWO string POUs would define it twice; hoist it into a
  // shared module when the emitter emits whole projects rather than one POU at a time.
  if (!p.code.includes("IecStr") && !p.code.includes("IecWString")) return { code: p.code, sourceMap: p.sourceMap, usesGlobals, usesPrograms }
  const offset = STRING_PRELUDE.split("\n").length - 1
  return {
    code: STRING_PRELUDE + p.code,
    sourceMap: p.sourceMap.map((m) => ({ ...m, line: m.line + offset })),
    usesGlobals,
    usesPrograms,
  }
}
