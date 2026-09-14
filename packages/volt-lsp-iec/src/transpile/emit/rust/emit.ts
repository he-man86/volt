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
    if (t.length === undefined) throw new Error(`no Rust mapping for ${t.name} without a capacity`)
    return `${t.name === "WSTRING" ? "IecWString" : "IecString"}<${t.length}>`
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

/**
 * The generated string types — prepended only to programs that use them. One `[T; N]` plus a length, a STRING's T a
 * byte and a WSTRING's a UTF-16 unit: `Copy`, so a store is a copy; `lit`/`to` keep at most N units, so every store
 * truncates by construction; equality and ordering compare the used units, which is CODESYS's comparison ('abc' < 'b',
 * 'A' < 'a' — test/exec `string_compare`, `wstring_basic`).
 */
const STRING_PRELUDE = `#[derive(Clone, Copy)]
pub struct IecStr<T: Copy, const N: usize> { len: usize, units: [T; N] }
pub type IecString<const N: usize> = IecStr<u8, N>;
pub type IecWString<const N: usize> = IecStr<u16, N>;
impl<T: Copy + Default, const N: usize> IecStr<T, N> {
    pub fn new() -> Self { Self { len: 0, units: [T::default(); N] } }
    pub fn lit(text: &[T]) -> Self { let mut s = Self::new(); let n = text.len().min(N); s.units[..n].copy_from_slice(&text[..n]); s.len = n; s }
    pub fn units(&self) -> &[T] { &self.units[..self.len] }
    pub fn to<const M: usize>(&self) -> IecStr<T, M> { IecStr::<T, M>::lit(self.units()) }
}
impl<T: Copy + Default, const N: usize> Default for IecStr<T, N> { fn default() -> Self { Self::new() } }
impl<T: Copy + PartialEq, const N: usize, const M: usize> PartialEq<IecStr<T, M>> for IecStr<T, N> { fn eq(&self, other: &IecStr<T, M>) -> bool { self.units[..self.len] == other.units[..other.len] } }
impl<T: Copy + PartialOrd, const N: usize, const M: usize> PartialOrd<IecStr<T, M>> for IecStr<T, N> { fn partial_cmp(&self, other: &IecStr<T, M>) -> Option<std::cmp::Ordering> { self.units[..self.len].partial_cmp(&other.units[..other.len]) } }
impl<T: Copy + Into<u32>, const N: usize> std::fmt::Debug for IecStr<T, N> { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { let text: String = self.units[..self.len].iter().map(|&u| char::from_u32(u.into()).unwrap_or('\\u{fffd}')).collect(); write!(f, "{:?}", text) } }
// The Standard string functions — line for line the interpreter's STRING_FUNCTIONS: 1-based, clamped positions.
fn iec_count(n: i64, s: &[u8]) -> usize { (n.max(0) as usize).min(s.len()) }
fn iec_span(s: &[u8], start: usize, length: usize) -> &[u8] { let start = start.min(s.len()); &s[start..(start + length).min(s.len())] }
fn iec_len(s: &[u8]) -> i64 { s.len() as i64 }
fn iec_left(s: &[u8], n: i64) -> Vec<u8> { s[..iec_count(n, s)].to_vec() }
fn iec_right(s: &[u8], n: i64) -> Vec<u8> { s[s.len() - iec_count(n, s)..].to_vec() }
fn iec_mid(s: &[u8], l: i64, p: i64) -> Vec<u8> { if p < 1 || l <= 0 { return Vec::new(); } iec_span(s, (p - 1) as usize, l as usize).to_vec() }
fn iec_concat(a: &[u8], b: &[u8]) -> Vec<u8> { [a, b].concat() }
fn iec_insert(a: &[u8], b: &[u8], p: i64) -> Vec<u8> { if p < 0 || p as usize > a.len() { return a.to_vec(); } let p = p as usize; [&a[..p], b, &a[p..]].concat() }
fn iec_delete(s: &[u8], l: i64, p: i64) -> Vec<u8> { if p < 1 || l <= 0 { return s.to_vec(); } let start = ((p - 1) as usize).min(s.len()); let end = start + iec_span(s, start, l as usize).len(); [&s[..start], &s[end..]].concat() }
fn iec_replace(a: &[u8], b: &[u8], l: i64, p: i64) -> Vec<u8> { iec_insert(&iec_delete(a, l, p), b, (p - 1).max(0)) }
fn iec_find(a: &[u8], b: &[u8]) -> i64 { if b.is_empty() { return 0; } a.windows(b.len()).position(|w| w == b).map_or(0, |i| i as i64 + 1) }
// TIME → STRING: T# and each non-zero component, largest first — 'T#1d2h', 'T#1s500ms', and 'T#0ms' for zero.
fn iec_time_text(ms: i64) -> String { let mut rest = ms; let mut out = String::new(); for (unit, suffix) in [(86_400_000i64, "d"), (3_600_000, "h"), (60_000, "m"), (1000, "s"), (1, "ms")] { let n = rest / unit; rest %= unit; if n != 0 { out.push_str(&format!("{}{}", n, suffix)); } } if out.is_empty() { out.push_str("0ms"); } format!("T#{}", out) }
// STRING → REAL: the same decimal prefix the interpreter's regex takes ('.5', '5.', '1.5E' is 1.5), else 0.
fn iec_parse_real(s: &[u8]) -> f64 { let mut i = 0; while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; } let start = i; if i < s.len() && (s[i] == b'+' || s[i] == b'-') { i += 1; } let int_start = i; while i < s.len() && s[i].is_ascii_digit() { i += 1; } let mut digits = i - int_start; if i < s.len() && s[i] == b'.' { i += 1; let frac = i; while i < s.len() && s[i].is_ascii_digit() { i += 1; } digits += i - frac; } if digits == 0 { return 0.0; } if i < s.len() && (s[i] == b'e' || s[i] == b'E') { let mut j = i + 1; if j < s.len() && (s[j] == b'+' || s[j] == b'-') { j += 1; } if j < s.len() && s[j].is_ascii_digit() { while j < s.len() && s[j].is_ascii_digit() { j += 1; } i = j; } } std::str::from_utf8(&s[start..i]).unwrap().parse().unwrap_or(0.0) }
// STRING → integer: leading spaces and tabs, an optional sign, then the digits, stopping at anything else (' 12abc' is 12).
fn iec_parse_int(s: &[u8]) -> i64 { let mut i = 0; while i < s.len() && (s[i] == b' ' || s[i] == b'\\t') { i += 1; } let neg = i < s.len() && s[i] == b'-'; if i < s.len() && (s[i] == b'-' || s[i] == b'+') { i += 1; } let mut v: i64 = 0; for &b in &s[i..] { if !b.is_ascii_digit() { break; } v = v.wrapping_mul(10).wrapping_add((b - b'0') as i64); } if neg { v.wrapping_neg() } else { v } }
`

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
  return rustType(t).replace("<", "::<")
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
        // STRING → STRING of another capacity: the copy that truncates
        // lowering only converts between strings of ONE width, so `to` keeps the unit type
        if (to === "string" && from === "string") return `${value}.to::<${rustType(e.type).slice(rustType(e.type).indexOf("<") + 1, -1)}>()`
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
    p.push(`${snake(slot.name)}: ${slot.init === undefined ? defaultLiteral(slot.type) : literal(slot.init, slot.type)},`, 3)
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

function defaultLiteral(t: Type): string {
  if (t.kind !== "elementary") return "Default::default()"
  if (t.elem.family === "bool") return "false"
  if (t.elem.family === "real") return "0.0"
  if (t.elem.family === "string") return "IecStr::new()"
  return "0"
}
