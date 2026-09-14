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
import type { IrExpr, IrMathName, IrPou, IrStmt, IrValue } from "../../ir/index.js"
import type { Span } from "../../../syntax/index.js"
import type { Type } from "../../../types/index.js"
import { STRING_PRELUDE } from "./prelude.js"

/** Emitted Rust, plus the line→ST mapping a panic or a failed assertion is reported through. */
export interface Emitted {
  code: string
  /** 1-based emitted line → the ST span it came from. */
  sourceMap: readonly { line: number; span: Span }[]
}

/** IEC elementary type → Rust type, derived from the type's own facts (family · bits · signed). */
export function rustType(t: Type): string {
  if (t.kind !== "elementary") throw new Error(`no Rust mapping for a ${t.kind} type`)
  const { family, bits, signed } = t.elem
  if (family === "bool") return "bool"
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

/** ST names are PascalCase/mixed; Rust fields are snake_case. Mechanical, and stable across runs. */
export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
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
      case "load": {
        const field = `self.${snake(slots[e.place.slot]!.name)}`
        const bit = e.place.path[0]
        return bit === undefined ? field : `(((${field} >> ${bit.index}) & 1) != 0)`
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
          // NOT `clamp`: Rust's panics when MN > MX, and CODESYS answers that case with MX for every IN (test/exec
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
        // build — found by the differential test (test/exec `unary_minus_at_the_edge`, a DINT at its minimum).
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
        const slot = slots[s.target.slot]!
        const field = `self.${snake(slot.name)}`
        const bit = s.target.path[0]
        if (bit === undefined) {
          this.push(`${field} = ${this.expr(s.value, slots)};`, indent, s.span)
          return
        }
        // a typed one — `1i16 << 15` is -32768, exactly the two's complement bit the IDE sets
        const one = `(1${rustType(slot.type)} << ${bit.index})`
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
        // One IR shape → one Rust shape: `loop` with the test placed at the head or the tail.
        for (const init of s.init) this.stmt(init, slots, indent)
        this.push("loop {", indent, s.span)
        if (s.test !== undefined && !s.test.atEnd)
          this.push(`if !${this.expr(s.test.cond, slots)} { break; }`, indent + 1)
        this.block(s.body, slots, indent + 1)
        for (const step of s.step) this.stmt(step, slots, indent + 1)
        if (s.test !== undefined && s.test.atEnd)
          this.push(`if !${this.expr(s.test.cond, slots)} { break; }`, indent + 1)
        this.push("}", indent)
        return
      }
      case "break":
        this.push("break;", indent, s.span)
        return
      case "continue":
        this.push("continue;", indent, s.span)
        return
      case "return":
        this.push("return;", indent, s.span)
        return
    }
  }
}

/** Emit one lowered POU as a Rust struct with a `scan` method. */
export function emitRust(pou: IrPou): Emitted {
  const p = new Printer()
  const name = pou.name.replace(/[^A-Za-z0-9_]/g, "_")

  p.push(`// generated from ${pou.name} — do not edit`, 0)
  p.push("#[derive(Debug, Default, Clone, PartialEq)]", 0)
  p.push(`pub struct ${name} {`, 0, pou.span)
  for (const slot of pou.slots) p.push(`pub ${snake(slot.name)}: ${rustType(slot.type)},`, 1)
  p.push("}", 0)
  p.push("", 0)
  p.push(`impl ${name} {`, 0)

  // `new` seeds the declared initial values; Default alone would zero them.
  p.push("pub fn new() -> Self {", 1)
  p.push("Self {", 2)
  for (const slot of pou.slots)
    p.push(`${snake(slot.name)}: ${literal(slot.init, slot.type)},`, 3)
  p.push("}", 2)
  p.push("}", 1)
  p.push("", 0)
  p.push("pub fn scan(&mut self) {", 1)
  p.block(pou.body, pou.slots, 2)
  p.push("}", 1)
  p.push("}", 0)

  // Only a program that holds a string gets the string type — every other output stays exactly what it was.
  // ponytail: the prelude rides with each POU, so a crate of TWO string POUs would define it twice; hoist it into a
  // shared module when the emitter emits whole projects rather than one POU at a time.
  if (!p.code.includes("IecStr") && !p.code.includes("IecWString")) return { code: p.code, sourceMap: p.sourceMap }
  const offset = STRING_PRELUDE.split("\n").length - 1
  return { code: STRING_PRELUDE + p.code, sourceMap: p.sourceMap.map((m) => ({ ...m, line: m.line + offset })) }
}
