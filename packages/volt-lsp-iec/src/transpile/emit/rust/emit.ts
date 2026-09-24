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
 * **Safe Rust, three forms of memory** (design §9). A POU, struct or FB is one owned `struct`, its body
 * `fn scan(&mut self)`; GVL variables are a `Globals` struct handed in as `g`, called PROGRAMs a `Programs` as `prg`. A
 * VAR_IN_OUT, which never outlives its call, is a `&mut` parameter; a POINTER or REFERENCE is a `usize` naming its one
 * target (0 is null), checked at every dereference. Lowering refuses whatever would need two `&mut` at once.
 *
 * **Deterministic numerics.** IEC integers wrap at their declared width, so arithmetic emits `wrapping_*`
 * rather than Rust's overflow-panicking defaults. The width comes from `types/elementary`, the same facts the
 * diagnostics use — there is no second table of type sizes here.
 */
import type { IrBinding, IrExpr, IrInit, IrLayout, IrMathName, IrPou, IrRoutine, IrStmt, IrValue, Place } from "../../ir/index.js"
import { defaultValueOf, elementOf, holdsCall, isBit, LOOP_CAP_MESSAGE, LOOP_ITERATION_CAP, peelArray } from "../../ir/index.js"
import type { Span } from "../../../syntax/index.js"
import { isTemporal, type Type } from "../../../types/index.js"
import { STRING_PRELUDE } from "./prelude.js"

/** Emitted Rust, plus the line→ST mapping a panic or a failed assertion is reported through. */
export interface Emitted {
  code: string
  /** 1-based emitted line → the ST span it came from. */
  /** Each emitted line that maps back to ST: the Rust line (1-based), the span, and the FILE the span indexes.
   *  `uri` is undefined for the POU's own body, which is the main source — a routine lowered from a GVL or a library
   *  declaration names its own file, because a span alone cannot say which source it belongs to. */
  sourceMap: readonly { line: number; span: Span; uri?: string }[]
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
  // a pointer or reference holds its one target's index, 0 when null (design §9 form 1)
  if (t.kind === "pointer" || t.kind === "reference") return "usize"
  // an interface holds the tag of the instance it names, 0 when null (design §22)
  if (t.kind === "interface") return "u64"
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

/**
 * A VAR_IN_OUT's Rust parameter type. An `ARRAY[*]` is a slice, and each open dimension inside it a const generic Rust
 * infers from the array every call lends — `grid : ARRAY[*, *] OF INT` is `&mut [[i16; N_GRID_2]]` (design §26).
 */
function inoutType(slot: { type: Type; readOnly?: boolean }, name: string): { param: string; generics: string[] } {
  const t = slot.type
  const borrow = slot.readOnly === true ? "&" : "&mut "
  // A STRING VAR_IN_OUT binds a string of ANY capacity — `VAR_IN_OUT text : STRING` takes a STRING(12) (conformance
  // `xo4_inout_constant_chain`), and lowering has already given the sizeless one its 80, so the declared number cannot
  // be told from a bound one here. The parameter is generic over the capacity, which is what the interpreter does by
  // binding the caller's place. ponytail: a store into a SIZED string in-out then truncates at the CALLER's capacity,
  // not the callee's — unmeasured, and the interpreter has always done the same, so the two backends agree.
  if (t.kind === "elementary" && t.elem.family === "string") {
    const n = `N_${name.toUpperCase()}`
    return { param: `${name}: ${borrow}${stringType(t).name}<${n}>`, generics: [`const ${n}: usize`] }
  }
  if (t.kind !== "array" || t.bounds !== undefined) return { param: `${name}: ${borrow}${rustType(t)}`, generics: [] }
  const generics = t.dims.slice(1).map((_, d) => `N_${name.toUpperCase()}_${d + 2}`)
  const inner = generics.reduceRight((element, n) => `[${element}; ${n}]`, rustType(t.element))
  return { param: `${name}: ${borrow}[${inner}]`, generics: generics.map((n) => `const ${n}: usize`) }
}

/** `<const N: usize, …>` after a fn name, or nothing. */
const genericList = (typed: readonly { generics: string[] }[]): string => {
  const all = typed.flatMap((t) => t.generics)
  return all.length === 0 ? "" : `<${all.join(", ")}>`
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
/** Does any block in this body put a statement AFTER a `return`? Only then is the dead tail the ST's own doing,
 *  and only then does that routine get `#[allow(unreachable_code)]`. */
function hasStatementAfterReturn(body: readonly IrStmt[]): boolean {
  const inBlock = (stmts: readonly IrStmt[]): boolean => {
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i]!
      if (s.kind === "return" && i < stmts.length - 1) return true
      for (const nested of nestedBlocks(s)) if (inBlock(nested)) return true
    }
    return false
  }
  return inBlock(body)
}

/** Every statement list a statement holds. */
function nestedBlocks(s: IrStmt): readonly (readonly IrStmt[])[] {
  switch (s.kind) {
    case "if":
      return [s.then, s.else]
    case "switch":
      return [...s.arms.map((a) => a.body), s.else]
    case "loop":
      return [s.init, s.body, s.step]
    default:
      return []
  }
}

export function fieldNames(slots: IrPou["slots"], reserved: readonly string[] = [], internal = false): string[] {
  const used = new Set<string>(reserved)
  return slots.map((slot) => {
    const snaked = snake(slot.name)
    const base = RUST_KEYWORDS.has(snaked) ? `${snaked}_` : snaked
    // A CONTRACT NAME IS NOT RENUMBERED. The dedupe below numbers by FRAME POSITION, so the FIRST slot with a given
    // snake name keeps it and later ones take `_2`, `_3` — which means declaring a new VAR ahead of an existing one
    // would rename the EXISTING one's Rust field, and a harness written against `p.my_val` breaks on an ST edit that
    // has nothing to do with it. A field is part of the emitted surface (`emit/rust/index.ts`), so it cannot move
    // under a user like that.
    //
    // Two distinct ST names snaking to one Rust name is genuinely ambiguous, and it does not happen: ZERO of the 784
    // POUs the fixtures build take a suffix. So it is refused rather than silently resolved — a loud stop on a shape
    // nobody writes beats a quiet rename on a shape everybody does.
    if (!internal && used.has(base))
      throw new Error(`emit: ${slot.name} and another variable both become the Rust field \`${base}\`, which the emitted surface cannot distinguish`)
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

/** True for a STRING or WSTRING type — the operands that need `iec_max`/`iec_min` rather than `Ord`. */
function isString(t: Type): boolean {
  return t.kind === "elementary" && (t.name === "STRING" || t.name === "WSTRING")
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
  // A REAL CONSTANT TOO BIG FOR ITS WIDTH IS AN INFINITY, not a compile error. `x : REAL := 3.5E38` is accepted by
  // CODESYS and holds `REAL#Infinity` (`bound_real_above_max`), while Rust refuses `3.5e38f32` outright —
  // "the literal does not fit into the type `f32` and will be converted to `f32::INFINITY`", denied by default. So
  // the conversion Rust is warning about is exactly the one the vendor performs: write it out.
  if (typeof v === "number" && !Number.isFinite(v) && !Number.isNaN(v))
    return `(${v < 0 ? "-" : ""}${t.kind === "elementary" ? rustType(t) : "f64"}::INFINITY)`
  if (typeof v === "number" && t.kind === "elementary" && t.elem.bits === 32 && t.elem.family === "real" && !Number.isFinite(Math.fround(v)))
    return `(${v < 0 ? "-" : ""}f32::INFINITY)`
  const text = `${v}${t.kind === "elementary" ? rustType(t) : ""}`.replace(/^(-?\d+)(f\d\d)$/, "$1.0$2")
  // A NEGATIVE CONSTANT IS PARENTHESIZED, because in Rust a method call binds TIGHTER than unary minus — the
  // classic `-1.abs()` trap. The emitter makes a constant the RECEIVER of a method in a dozen places
  // (`wrapping_*`, `max`/`min`, `limit`, `abs`, the shifts and rotates, `round`, `clone`, the string helpers),
  // and in every one of them a bare `-1i32` let the sign escape the call:
  //
  //   MAX(E_Sign.Neg, x)  with Neg := -1 and x := 5  ->  `-1i32.max((self.x as i32))`
  //
  // which Rust reads as `-(1.max(5))` = -5 where the interpreter and CODESYS answer 5. A silent wrong answer,
  // reachable from an ordinary negative enum value, and no recorded case caught it. Parenthesizing HERE fixes
  // every receiver position at once rather than at each of the dozen call sites, which is the only version of
  // this fix that a thirteenth call site cannot defeat.
  return text.startsWith("-") ? `(${text})` : text
}

/**
 * Drop an outer paren pair the position does not need.
 *
 * The printer parenthesizes every binary, every cast and every unary, which is the only way a printer with no
 * precedence table can be correct — and it means a complete expression arrives at a STATEMENT position already
 * wrapped. `self.q1 = ((self.a as i32) / (self.b as i32));` is what rustc's own `unused_parens` names, and it was
 * emitted 2,722 times across the conformance fixtures.
 *
 * ONLY WHERE THE EXPRESSION STANDS ALONE — an assignment's right-hand side, an `if` condition, a `match` selector.
 * Never at a RECEIVER: `literal()`'s comment above spells out what `(-1i32).max(x)` costs without its parens, and
 * the balanced walk below is what keeps `(a + b).to()` — whose first `(` does not close at the end — untouched.
 */
function unparen(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    // the emitted Rust carries string literals (`panic!`, byte strings), and a paren inside one is not structure
    if (c === '"') {
      while (++i < text.length && text[i] !== '"') if (text[i] === "\\") i++
      continue
    }
    if (c === "(") depth++
    else if (c === ")" && --depth === 0) return i === text.length - 1 ? unparen(text.slice(1, -1)) : text
  }
  return text
}

/**
 * `unparen`, EXCEPT where a bare `{` would be read as the body rather than the scrutinee.
 *
 * An `if` condition and a `match` selector are the one position Rust treats specially: `if { … } { … }` and
 * `match match k { … } { … }` are ambiguous at best. `SEL` prints `({ … })` and `MUX` prints `(match … { … })`,
 * so an `IF SEL(…)` or a `CASE MUX(…)` reaches exactly that — and no fixture writes one, so the suite would not
 * have said. Everywhere else a block-like expression unwraps fine, which is why this is not inside `unparen`:
 * putting it there kept the parentheses on 83 assignment right-hand sides that did not need them.
 */
function unparenHead(text: string): string {
  const inner = text.startsWith("(") ? text.slice(1, -1).trimStart() : ""
  const blockLike = ["{", "match ", "if ", "unsafe ", "loop ", "while "].some((s) => inner.startsWith(s))
  return blockLike ? text : unparen(text)
}

/**
 * `text as target`, or `text` unchanged when it already IS that Rust type — the twin of the identity rule in
 * `convert`, for the casts a BUILTIN adds on top of an argument the IR already typed: `SHL`s `as u32`, the math
 * helpers `as f64`, the string helpers `as i64`. Parenthesized when it does cast, because every one of these
 * lands in a receiver or an argument position.
 */
function castTo(text: string, from: Type, target: string): string {
  return rustType(from) === target ? text : `(${text} as ${target})`
}


/** Whether the emitted Rust for this type is `Copy` — everything the printer emits except a DUT struct and an FB
 *  instance, both of which derive only `Clone`. An array is `Copy` exactly when its element is. */
function isCopy(t: Type): boolean {
  if (t.kind === "array") return isCopy(t.element)
  return t.kind === "elementary" || t.kind === "pointer" || t.kind === "reference" || t.kind === "interface"
}
/** The result of an `f64` math routine, narrowed to the IEC type — or left alone when that type IS `f64`. */
function fromF64(text: string, target: string): string {
  return target === "f64" ? text : `(${text} as ${target})`
}

/**
 * `Default` alongside `new` — deferring to it, never duplicating the initial values.
 *
 * A Rust type with a no-argument `new` and no `Default` is what `clippy::new_without_default` names, and it named
 * all 2,289 structs the fixtures emit. It is not derived (Rust derives `Default` only for arrays up to 32 elements,
 * which is why `new` builds every value explicitly) and it is not the CONTRACT — `emit/rust/index.ts` says a
 * harness constructs through `::new()`. This exists so the emitted crate composes the way a Rust programmer expects:
 * `Default::default()`, `..Default::default()`, and a struct holding one of these deriving its own.
 */
function defaultImpl(p: Printer, name: string): void {
  p.push(`impl Default for ${name} {`, 0)
  p.push("fn default() -> Self {", 1)
  p.push("Self::new()", 2)
  p.push("}", 1)
  p.push("}", 0)
  p.push("", 0)
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

/**
 * The comparison a NEGATED one is. A loop test prints as `if !<cond> { break; }`, and a loop's condition is almost
 * always a comparison — `!(i <= 2)` is what `clippy::nonminimal_bool` names, 39 times across the fixtures, and
 * `i > 2` is the same test. Flipped HERE, on the IR node, rather than by rewriting the printed text.
 */
const INVERSE: Readonly<Record<string, string>> = { eq: "ne", ne: "eq", lt: "ge", le: "gt", gt: "le", ge: "lt" }

class Printer {
  private readonly lines: string[] = []
  readonly sourceMap: { line: number; span: Span; uri?: string }[] = []
  /** The file whose spans `push` is currently recording — set around each routine (`printRoutine`). */
  sourceUri: string | undefined = undefined

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
    /** Every routine's Rust fn name, deduped once — see `routineFnNames`. Read by the definition AND the calls. */
    readonly fnNames: ReadonlyMap<string, string>,
    /** Each global slot's Rust access (`g.g_shared`, `prg.prg_writer`), and the slots — `IrPou.globals`' order. */
    private readonly globals: { access: readonly string[]; slots: IrPou["slots"] },
    /** The program reaches GVL variables — every generated call is handed `g`. */
    private readonly usesGlobals: boolean,
    /** The program reaches PROGRAM instances — every generated call is handed `prg` too, as any body may call one. */
    private readonly usesPrograms = false,
  ) {}

  /** `g` and `prg` before a generated call's arguments, as far as the program has them. */
  get globalsArg(): string[] {
    return [...(this.usesGlobals ? ["g"] : []), ...(this.usesPrograms ? ["prg"] : [])]
  }

  /**
   * A slot's initial value as a Rust expression: a struct or FB instance at its TYPE's values (`new()`), with the fields
   * an aggregate initializer names set over them; an array element by element, each left out at its type's own.
   */
  initOf(t: Type, init: IrInit): string {
    if (t.kind === "struct" || t.kind === "function_block") {
      const base = `${rustName(t.name)}::new()`
      const named = typeof init === "object" && "fields" in init ? init.fields : undefined
      const entry = this.layouts.get(t.name.toUpperCase())
      if (named === undefined || entry === undefined) return base
      const sets = entry.layout.fields.flatMap((f, i) => (named[f.name.toUpperCase()] === undefined ? [] : [`v.${entry.fields[i]} = ${this.initOf(f.type, named[f.name.toUpperCase()]!)};`]))
      return sets.length === 0 ? base : `{ let mut v = ${base}; ${sets.join(" ")} v }`
    }
    const array = peelArray(t)
    const elements = typeof init === "object" && "elements" in init ? init.elements : undefined
    if (array === undefined || elements === undefined) return initOf(t, init as IrValue)
    return `[${Array.from({ length: array.length }, (_, i) => this.initOf(array.element, elements[i] ?? defaultValueOf(array.element))).join(", ")}]`
  }

  /** The parameters every generated body declares for them. */
  get globalsParams(): string[] {
    return [...(this.usesGlobals ? ["g: &mut Globals"] : []), ...(this.usesPrograms ? ["prg: &mut Programs"] : [])]
  }

  /** Print `run` inside an FB's `call` or a routine: `fields` are `self`'s, the frame holds its parameters and locals. */
  inFrame(fields: readonly string[], frame: Frame, run: () => void): void {
    const saved = [this.fields, this.frame] as const
    ;[this.fields, this.frame] = [fields, frame]
    run()
    ;[this.fields, this.frame] = saved
  }

  /** An instance lent to a call (design §24): `&mut place` — and `THIS^`, already `&mut self`, reborrowed as `&mut *self`
   *  (`&mut self` is a `&mut &mut`, E0596; review of the interface-input batch, 2026-09-15). */
  lendMut(place: Place, slots: IrPou["slots"]): string {
    return place.root === "this" && place.path.length === 0 ? "&mut *self" : `&mut ${this.place(place, slots)}`
  }

  /** A VAR_IN_OUT argument: `&mut place` — a VAR_IN_OUT CONSTANT's `&place`, or `&__copy_i`, the copy `lentCopies` took. */
  lend(b: IrBinding, i: number, param: IrPou["slots"][number], slots: IrPou["slots"]): string {
    if ("kind" in b) return b.back !== undefined ? `&mut __copy_${i}` : `&__copy_${i}`
    return `${param.readOnly === true ? "&" : "&mut "}${this.place(b, slots)}`
  }

  /** After the call, each copy marked `back` stored to its place: `self.points = __copy_0;` (an own field lent to an own METHOD). */
  copiesBack(bindings: readonly IrBinding[], slots: IrPou["slots"]): string {
    return bindings.flatMap((b, i) => ("kind" in b && b.back !== undefined ? [`${this.place(b.back, slots)} = __copy_${i};`] : [])).join(" ")
  }

  /**
   * The copies a call lends its VAR_IN_OUT CONSTANTs, each into a `let` before the call — so a copy of `x` sits beside a
   * `&mut x` of the same call, which `f(&mut self.x, &{ self.x })` could not (E0503; review of the batch, 2026-09-15). No
   * argument holds a call (`call-nested`), so taking them first changes no order anything can observe.
   */
  lentCopies(bindings: readonly IrBinding[], slots: IrPou["slots"]): string {
    return bindings.flatMap((b, i) => ("kind" in b ? [`let ${b.back !== undefined ? "mut " : ""}__copy_${i} = ${this.expr(b.value, slots)};`] : [])).join(" ")
  }

  /** A read through a dereference, checked first: `{ iec_deref(self.p); self.value }` — the null pointer panics. */
  guarded(place: Place, text: string, slots: IrPou["slots"]): string {
    // the guarded value is the BLOCK's tail — it stands alone there, so a `(*v)` needs no parentheses of its own
    return place.guard === undefined ? text : `{ iec_deref(${this.place(place.guard, slots)}); ${unparen(text)} }`
  }

  /** A write through a dereference is checked on the line before it. */
  guardLine(place: Place, slots: IrPou["slots"], indent: number): void {
    if (place.guard !== undefined) this.push(`iec_deref(${this.place(place.guard, slots)});`, indent)
  }

  /** A place as a Rust lvalue — `self.inst.q`, `self.arr[(self.i as i64 - 1i64) as usize].x`, `(*v)`, `count` — without a final bit step. */
  place(p: Place, slots: IrPou["slots"]): string {
    // A BORROW NEEDS NO `*` WHEN A FIELD OR AN INDEX FOLLOWS — Rust auto-derefs through `.x` and `[i]`, so
    // `(*path).used` is `path.used` and `clippy::explicit_auto_deref` says so. It IS needed when the place is the
    // whole value (`*v = x`, `*v + 1`) and when a BIT step follows, which shifts the value itself.
    const through = p.path[0]?.kind === "field" || p.path[0]?.kind === "index"
    const deref = (name: string): string => (through ? name : `(*${name})`)
    let text =
      p.root === "inout"
        ? deref(this.frame.inoutNames[p.slot]!)
        : p.root === "lent"
          ? deref(`__lent_${p.slot}`)
        : p.root === "local"
          ? this.frame.localNames[p.slot]!
          : p.root === "global"
            ? this.globals.access[p.slot]!
            : p.root === "this"
              ? "self"
              : `self.${this.fields[p.slot]}`
    let type: Type =
      p.root === "inout"
        ? this.frame.inoutSlots[p.slot]!.type
        : p.root === "lent"
          ? p.type
        : p.root === "local"
          ? this.frame.localSlots[p.slot]!.type
          : p.root === "global"
            ? this.globals.slots[p.slot]!.type
            : p.root === "this"
              ? this.frame.selfType!
              : slots[p.slot]!.type
    for (const step of p.path) {
      if (step.kind === "field") {
        const entry = type.kind === "struct" || type.kind === "function_block" ? this.layouts.get(type.name.toUpperCase()) : undefined
        const i = entry?.layout.fields.findIndex((f) => f.name.toUpperCase() === step.name.toUpperCase()) ?? -1
        if (entry === undefined || i < 0) throw new Error(`no field ${step.name} in ${type.kind}`)
        text += `.${entry.fields[i]}`
        type = entry.layout.fields[i]!.type
      } else if (step.kind === "index") {
        // WIDENED TO i64 ONLY WHEN IT IS NOT ONE. An index is usually already `i64` after lowering, and the
        // unconditional `as i64` printed `(0i64 as i64) as usize` — a cast to its own type inside parentheses
        // neither rustc nor clippy has any use for.
        const index = castTo(this.expr(step.index, slots), step.index.type, "i64")
        // NOT `unparen`ed, and that is the whole point: `as` binds TIGHTER than the arithmetic operators, so
        // stripping the printer's parentheses off `(self.li / 2i64)` leaves `self.li / 2i64 as usize`, which Rust
        // reads as `self.li / (2i64 as usize)` — E0277, `cannot divide i64 by usize`. `arr[li / 2]` is the reaching
        // case and no fixture has one, so the suite stayed green over an emission that does not compile.
        // a negative offset wraps to a huge usize, so an index below the lower bound panics like one above the upper
        text += step.lower === 0n ? `[${index} as usize]` : `[(${index} - ${step.lower}i64) as usize]`
        type = elementOf(type)!
      }
    }
    return text
  }

  /** A place in a PROGRAM's one instance, as a call on it runs: the program moved out of `Programs` (`program`, of `type`),
   *  and the path from it to the instance (`member`, empty for the program itself). */
  /** The PROGRAM's own place and the member path under it — a call runs it moved out of `Programs` and puts it back.
   *  It used to return the program's TYPE as well, for `std::mem::replace(&mut p, T::new())`; `mem::take` needs no
   *  stand-in to swap in, so the type went with it. `take` is why the `Default` impl is not optional. */
  movedOut(p: Place, slots: IrPou["slots"]): { program: string; member: string } {
    const program = this.place({ ...p, path: [] }, slots)
    return { program, member: this.place(p, slots).slice(program.length) }
  }

  push(text: string, indent: number, span?: Span): void {
    this.lines.push(`${"    ".repeat(indent)}${text}`)
    if (span !== undefined) this.sourceMap.push({ line: this.lines.length, span, ...(this.sourceUri === undefined ? {} : { uri: this.sourceUri }) })
  }

  get code(): string {
    return `${this.lines.join("\n")}\n`
  }

  /** `NOT e`, as a comparison flipped where it is one — the loop test's `if !<cond> { break; }`. */
  negated(e: IrExpr, slots: IrPou["slots"]): string {
    // a comparison flips; `NOT NOT x` is `x`; a constant is the other constant. A REPEAT's test arrives already
    // negated (`UNTIL` is the exit condition), so without the double-negation case every REPEAT printed
    // `if !(!(n > 5)) { break; }` — three of the four `nonminimal_bool` findings left after the first pass.
    //
    // NOT FOR A REAL OPERAND. Flipping an ordering comparison is negation only over a total order, and floats are
    // not one: with a NaN operand every one of `<`, `<=`, `>`, `>=` is false, so `!(r <= 10.0)` is TRUE and
    // `r > 10.0` is FALSE. `WHILE r <= 10.0` over a NaN exits at once in the interpreter and never exits in the
    // emitted Rust — an infinite loop, and a divergence no fixture reaches. `eq`/`ne` are safe (NaN makes `eq`
    // false and `ne` true, which are still each other's negation), and only the four orderings are excluded.
    const ordering = e.kind === "binary" && e.op !== "eq" && e.op !== "ne"
    const overReals = (x: IrExpr): boolean => x.type.kind === "elementary" && x.type.elem.family === "real"
    if (e.kind === "binary" && INVERSE[e.op] !== undefined && !(ordering && (overReals(e.left) || overReals(e.right))))
      return unparen(this.expr({ ...e, op: INVERSE[e.op] } as IrExpr, slots))
    if (e.kind === "unary" && e.op === "not") return unparen(this.expr(e.operand, slots))
    if (e.kind === "const" && typeof e.value === "boolean") return e.value ? "false" : "true"
    return `!${this.expr(e, slots)}`
  }

  expr(e: IrExpr, slots: IrPou["slots"]): string {
    switch (e.kind) {
      case "const":
        return literal(e.value, e.type)
      // A fresh composite — the emitted twin of the interpreter's `instantiate`, and the same `initOf` a slot's
      // declaration already uses. Only a VAR_TEMP reset reaches it.
      case "fresh":
        return initOf(e.type, e.init as IrValue)
      case "invoke": {
        // the inputs by value, then the VAR_IN_OUT as `&mut` — a METHOD or ACTION on its instance, a FUNCTION free
        const routine = this.routines.get(e.routine)!
        // An input holding a call makes its evaluation order visible: every input is then taken into a `let`, in the order
        // written (`callshape_argument_order`) — which also keeps a call on the same instance out of the argument list's
        // borrow. Inputs without one stay inline, where no order can show — except on a PROGRAM's METHOD, whose inline
        // arguments would run after the program is moved out and read its `::new()` stand-in (review of batch 3a).
        const onProgram = e.instance !== undefined && e.instance.root === "global" && this.globals.slots[e.instance.slot]?.section === "program"
        const hoisted = onProgram || e.inputs.some(holdsCall)
        const inputLets = hoisted
          ? [...(e.order ?? e.inputs.keys())].map((k) => (typeof k === "number" ? `let __arg_${k} = ${this.expr(e.inputs[k]!, slots)};` : `${this.place(k.temp, slots)} = ${this.expr(k.value, slots)};`)).join(" ")
          : ""
        const inputs = e.inputs.map((a, k) => (hoisted ? `__arg_${k}` : unparen(this.expr(a, slots))))
        // the inputs, the in-outs, then each instance lent to the routine (design §24)
        const args = [...this.globalsArg, ...inputs, ...e.inouts.map((b, i) => this.lend(b, i, routine.inouts[i]!, slots)), ...(e.lent ?? []).map((l) => this.lendMut(l, slots))].join(", ")
        const fn = this.fnNames.get(routine.key)!
        // a METHOD of a PROGRAM's one instance runs moved out of `Programs`, as the program's call does (`prg` is handed in)
        const moved = onProgram ? this.movedOut(e.instance!, slots) : undefined
        // A ROUTINE WITH NO RESULT YIELDS `()`, and binding that is `clippy::let_unit_value`. The binding exists to
        // hold the value across the copy-back / the move-back, which a `()` needs no help with: the call runs as a
        // statement and the block's own value is the unit it would have carried.
        const yields = routine.result !== undefined
        const call =
          e.instance === undefined
            ? `${fn}(${args})`
            : moved !== undefined
              ? yields
                ? `{ let mut __program = std::mem::take(&mut ${moved.program}); let __result = __program${moved.member}.${fn}(${args}); ${moved.program} = __program; __result }`
                : `{ let mut __program = std::mem::take(&mut ${moved.program}); __program${moved.member}.${fn}(${args}); ${moved.program} = __program; }`
              : this.guarded(e.instance, `${this.place(e.instance, slots)}.${fn}(${args})`, slots)
        // a VAR_IN_OUT bound through a dereference is checked before the call, as the interpreter checks it when binding
        const checked = e.inouts.reduce((text, b) => ("kind" in b ? text : this.guarded(b, text, slots)), call)
        const lets = [inputLets, this.lentCopies(e.inouts, slots)].filter((l) => l !== "").join(" ")
        const back = this.copiesBack(e.inouts, slots)
        if (back !== "") return yields ? `{ ${lets} let __back = ${checked}; ${back} __back }` : `{ ${lets} ${checked}; ${back} }`
        return lets === "" ? checked : `{ ${lets} ${checked} }`
      }
      case "dispatch": {
        // a call through an interface: its value picks the instance; none — a null interface — panics (design §22).
        //
        // `panic!` IS `!`, which coerces to any type, so the arm needs no help — EXCEPT when there is no other arm.
        // An interface nothing is ever stored into makes every arm `!`, so the match itself is `!`, which no cast
        // takes (E0605) and rustc calls unreachable (found in a review, 2026-09-15). A closure of the call's own
        // type fixes that, and it was applied to EVERY dispatch, which is 19 `clippy::redundant_closure_call`.
        const arms = e.arms.map((a) => `${a.tag} => ${this.expr(a.call, slots)},`).join(" ")
        const typed = e.type.kind === "unknown" ? "()" : rustType(e.type)
        const nothing = `panic!("call through an interface that holds no instance")`
        const none = e.arms.length === 0 ? `(|| -> ${typed} { ${nothing} })()` : nothing
        return `(match ${this.expr(e.tag, slots)} { ${arms} _ => ${none} })`
      }
      case "load": {
        const field = this.place(e.place, slots)
        const bit = e.place.path.at(-1)
        // bit 0 needs no shift — `x >> 0` is `clippy::identity_op`, and the mask alone says the same thing
        if (bit?.kind === "bit")
          return this.guarded(e.place, `((${bit.index === 0 ? field : `(${field} >> ${bit.index})`} & 1) != 0)`, slots)
        // a whole struct, instance or array is copied, never moved out of `self` — but only a struct or an FB
        // instance needs `.clone()` to do it. Everything else the emitter prints IS `Copy`: the elementary types,
        // `IecStr` (which derives it), a pointer's `usize`, an interface's tag, and an array of any of those.
        // `.clone()` on a `Copy` value is `clippy::clone_on_copy` and reads as if something were being deep-copied.
        return this.guarded(e.place, isCopy(e.type) ? field : `${field}.clone()`, slots)
      }
      case "convert": {
        // The measured rules (design §11), each where Rust's bare `as` means something else: a float → int `as`
        // TRUNCATES and SATURATES, where CODESYS rounds half away from zero (`f64::round` is exactly that) and wraps
        // (through i64, then `as` between ints wraps); `as bool` does not exist; nor does `bool as f32`.
        const value = this.expr(e.value, slots)
        const from = e.value.type.kind === "elementary" ? e.value.type.elem.family : undefined
        const to = e.type.kind === "elementary" ? e.type.elem.family : undefined
        const target = rustType(e.type)
        // A CONVERSION TO THE RUST TYPE THE VALUE ALREADY HAS IS NOTHING. `WORD_TO_UINT` and `UINT_TO_WORD` are both
        // `u16 as u16`; so is every conversion between an alias and what it aliases. The printer emitted the cast
        // anyway — 578 of them across the fixtures, which is what `clippy::unnecessary_cast` names. STRING is
        // excluded because two `IecString`s of different capacity are a real copy, not a cast.
        if (from !== undefined && to !== undefined && from !== "string" && to !== "string" && rustType(e.value.type) === target)
          return value
        // STRING → STRING: the copy that truncates at the target's capacity, and across the two WIDTHS one code unit
        // per code unit (conformance `xo3_string_wide_conversions`).
        if (to === "string" && from === "string") {
          const target = stringType(e.type)
          const source = stringType(e.value.type)
          const how = target.name === source.name ? "to" : target.name === "IecString" ? "narrow" : "widen"
          return `${value}.${how}::<${target.capacity}>()`
        }
        if (to === "string") {
          const source = e.value.type.kind === "elementary" ? e.value.type.name : ""
          const text =
            from === "bool"
              ? `(if ${unparen(value)} { "TRUE" } else { "FALSE" })`
              : isTemporal(source)
                ? `iec_${source.toLowerCase()}_text(${unparen(castTo(value, e.value.type, "i64"))})`
                : source === "LREAL"
                  ? `iec_lreal_text(${unparen(value)})`
                  : `format!("{}", ${unparen(value)})`
          return `${stringPath(e.type)}::lit(${text}.as_bytes())`
        }
        // the parse helpers already RETURN `f64` / `i64`; casting to the same type is `unnecessary_cast`
        if (from === "string") {
          const parsed = `iec_parse_${to === "real" ? "real" : "int"}(${value}.units())`
          return target === (to === "real" ? "f64" : "i64") ? parsed : `(${parsed} as ${target})`
        }
        if (to === "bool") return from === "bool" ? value : from === "real" ? `(${value} != 0.0)` : `(${value} != 0)`
        if (from === "bool") return to === "real" ? `((${value} as u8) as ${target})` : `(${value} as ${target})`
        // REAL -> INTEGER IS DONE AT THE DESTINATION'S REGISTER WIDTH, then wrapped into the target — the emitted
        // twin of `coerce` in the interpreter, where the 192 measured cells are set out. This went through a 64-bit
        // register for every destination, which is the one thing four measurements could not distinguish: a 32-bit
        // destination has its OWN indefinite, 0x80000000, and that is why `LREAL_TO_DINT(-1.0E30)` is -2147483648
        // and not 0. Rust's own `as` saturates, which is neither.
        if (from === "real" && to !== "real") {
          const wide = e.type.kind === "elementary" && e.type.elem.bits >= 64
          // the helper already RETURNS the register width; casting i32 to i32 is what `unnecessary_cast` names
          const helper = wide ? "iec_r2i64" : "iec_r2i32"
          const call = `${helper}(${unparen(castTo(value, e.value.type, "f64"))})`
          return target === (wide ? "i64" : "i32") ? call : `(${call} as ${target})`
        }
        return `(${value} as ${target})`
      }
      case "builtin": {
        const args = e.args.map((a) => this.expr(a, slots))
        // ARGUMENT positions need none of the printer's parentheses; `args` keeps them because several of these
        // builtins use an argument as a RECEIVER, where `(-1i32).abs()` is not `-1i32.abs()`.
        const argv = args.map(unparen)
        switch (e.name) {
          // A STRING has no `Ord`, only the cross-length `PartialOrd` the prelude defines, so `.max()` does not
          // resolve on one (E0599 — the error that had MAX over a STRING refused in the first place). `iec_max`
          // and `iec_min` need only that `PartialOrd`, and pick the same operand the interpreter's `ord` does.
          case "max":
          case "min":
            return isString(e.type)
              ? args.reduce((acc, a) => `iec_${e.name}(${acc}, ${a})`)
              : args.reduce((acc, a) => `${acc}.${e.name}(${unparen(a)})`)
          // NOT `clamp`: Rust's panics when MN > MX, and CODESYS answers that case with MX for every IN (conformance
          // `limit_inverted_bounds`). MIN(MAX(IN, MN), MX) is exactly the measured behaviour.
          case "limit":
            return isString(e.type)
              ? `iec_min(iec_max(${args[1]}, ${args[0]}), ${args[2]})`
              : `${args[1]}.max(${argv[0]}).min(${argv[2]})`
          // EAGER, as the IR states: the arms are bound BEFORE the branch, so both are evaluated exactly once
          // like every other argument list. Printed as `if c { b } else { a }` the unselected arm was never
          // evaluated, and an argument with a side effect meant one thing here and another in the interpreter.
          case "sel":
            return `({ let __sel_c = ${argv[0]}; let __sel_f = ${argv[1]}; let __sel_t = ${argv[2]}; if __sel_c { __sel_t } else { __sel_f } })`
          // Toward zero into an i32 whose out-of-range (and NaN) answer is i32::MIN — CODESYS's TRUNC(3.0E9) is
          // -2147483648, not a wrap and not Rust's saturating `as` — then `as` wraps that into INT for TRUNC_INT.
          case "trunc":
            return `({ let t = ${castTo(args[0]!, e.args[0]!.type, "f64")}.trunc(); if (-2147483648.0..=2147483647.0).contains(&t) { t as i32 } else { i32::MIN } }${rustType(e.type) === "i32" ? "" : ` as ${rustType(e.type)}`})`
          // Rust's own features, each proven to match at the edges (design §13, §14): `wrapping_shl`/`wrapping_shr`
          // mask the count to the width's bits exactly as CODESYS does and shift a signed value arithmetically;
          // `rotate_left`/`rotate_right` take the count modulo the width.
          case "shl":
            return `${args[0]}.wrapping_shl(${unparen(castTo(args[1]!, e.args[1]!.type, "u32"))})`
          case "shr":
            return `${args[0]}.wrapping_shr(${unparen(castTo(args[1]!, e.args[1]!.type, "u32"))})`
          case "rol":
            return `${args[0]}.rotate_left(${unparen(castTo(args[1]!, e.args[1]!.type, "u32"))})`
          case "ror":
            return `${args[0]}.rotate_right(${unparen(castTo(args[1]!, e.args[1]!.type, "u32"))})`
          case "mux": {
            // a match ARM stands alone; the printer's parentheses around each one are `unused_parens`
            const [k, ...inputs] = argv
            const arms = inputs.map((input, i) => (i === inputs.length - 1 ? `_ => ${input}` : `${i} => ${input}`))
            return `(match ${k} { ${arms.join(", ")} })`
          }
          case "expt":
            return fromF64(`${castTo(args[0]!, e.args[0]!.type, "f64")}.powf(${unparen(castTo(args[1]!, e.args[1]!.type, "f64"))})`, rustType(e.type))
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
              a.type.kind === "elementary" && a.type.elem.family === "string" ? `${args[i]}.units()` : unparen(castTo(args[i]!, a.type, "i64")),
            )
            const call = `iec_${e.name}(${passed.join(", ")})`
            return e.name === "len" || e.name === "find" ? `(${call} as ${rustType(e.type)})` : `${stringPath(e.type)}::lit(&${call})`
          }
          // The emitted twin of `MATH`'s `logarithm` guard: `LN(0)` and `LOG(0)` stop the task on CODESYS, and Rust
          // answers `-inf` and carries on. Nothing else in this group stops anything — `EXP(1000)` is an infinity
          // and runs. Measured in `operators/math-domain.ts`.
          case "ln":
          case "log":
            return fromF64(`iec_log(${unparen(castTo(args[0]!, e.args[0]!.type, "f64"))}).${RUST_MATH[e.name]}()`, rustType(e.type))
          case "sqrt":
          case "exp":
          case "sin":
          case "cos":
          case "tan":
          case "asin":
          case "acos":
          case "atan":
            // through f64 and back, the same path the interpreter takes — `f32::ln` is a different float32 routine
            return fromF64(`${castTo(args[0]!, e.args[0]!.type, "f64")}.${RUST_MATH[e.name]}()`, rustType(e.type))
        }
        // A BUILTIN THIS DOES NOT PRINT MUST STOP HERE. The inner switch had no default, so an unhandled name fell
        // OUT of it and straight into `case "unary"` below — which reads `e.operand`, a field a builtin node does
        // not have. The result was `undefined` spliced into the emitted Rust, for a name nobody had noticed adding.
        throw new Error(`emit: no Rust for the builtin ${e.name}`)
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
        // Rust's `&`/`|` on bool evaluate both sides, as AND/OR do in the interpreter; `&&`/`||` are AND_THEN/OR_ELSE.
        // BOOL AND printed `&&`, so a call on the right ran in one backend and not the other (transpiler review 2026-09-15).
        if (e.op === "and" || e.op === "or" || e.op === "xor") return `(${l} ${e.op === "and" ? "&" : e.op === "or" ? "|" : "^"} ${r})`
        const wrapping = WRAPPING[e.op]
        const isReal = e.type.kind === "elementary" && e.type.elem.family === "real"
        // MOD by zero is 0, measured (`mod_by_zero`), where Rust's `%` panics; each operand is evaluated once, left first.
        //
        // THE BINDINGS CARRY THE RESERVED PREFIX, and that is not cosmetic. They were `a` and `d`, and a routine's
        // parameters are Rust LOCALS: in `FUNCTION F : INT VAR_INPUT a : INT; b : INT; END_VAR F := b MOD a;` the
        // emitted `let a = b` SHADOWED the parameter `a`, so the very next binding — `let d = a` — read the left
        // operand instead of the right, and `7 MOD 3` compiled to `7 % 7` = 0 where the interpreter answers 1.
        // A silent wrong answer, and one no recorded case caught because no fixture names a parameter `a`.
        if (e.op === "mod" && !isReal)
          return `({ let __mod_l = ${unparen(l)}; let __mod_r = ${unparen(r)}; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } })`
        // INTEGER DIVISION IS NOT WRAPPING. `wrapping_div` returns the minimum for `MIN / -1` and carries on, and
        // CODESYS STOPS THE TASK there (`arithedge_dint_div_min_by_minus_one`, `arithedge_lint_*`). Plain `/` panics
        // on exactly the two cases the vendor stops on — a zero divisor and that one overflow — so it is both the
        // simpler emission and the correct one. `+`, `-` and `*` really do wrap and keep their helpers.
        // the argument of a call needs no parentheses of its own — `wrapping_add((x as i32))` is one pair too many
        if (wrapping !== undefined && !isReal && e.op !== "div") return `${l}.wrapping_${wrapping}(${unparen(r)})`
        const plain = e.op === "add" ? "+" : e.op === "sub" ? "-" : e.op === "mul" ? "*" : e.op === "div" ? "/" : "%"
        // A REAL DIVISION BY ZERO STOPS THE TASK, and nothing else about an infinity does. This wrapped EVERY real
        // operation in a finiteness check, on the reading that an infinite RESULT is what stops it; `real-overflow.ts`
        // measured `1.0E38 / 1.0E-38` overflowing to `REAL#Infinity` with the scan completing, so the result was
        // never the rule. Rust's `f32`/`f64` division answers `inf` for a zero divisor instead of panicking the way
        // integer division does, so the divisor is checked explicitly — the emitted twin of `arith` in `values.ts`.
        return isReal && e.op === "div" ? `iec_div(${unparen(l)}, ${unparen(r)})` : `(${l} ${plain} ${r})`
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
        this.guardLine(s.target, slots, indent)
        const field = this.place(s.target, slots)
        const bit = s.target.path.at(-1)
        if (bit?.kind !== "bit") {
          // A string stored INTO a place whose capacity is a GENERIC — a STRING VAR_IN_OUT (`inoutType`) — cannot name
          // that capacity, in a turbofish or in a literal's own type, so the copy into it is left for Rust to infer
          // from the target. Harmless where the capacity is a number: `to()` is the same truncating copy.
          const into = s.target.type
          const value = this.expr(s.value, slots)
          const copied = into.kind === "elementary" && into.elem.family === "string" ? `${value}.to()` : value
          this.push(`${unparen(field)} = ${unparen(copied)};`, indent, s.span)
          return
        }
        // a typed one — `1i16 << 15` is -32768, exactly the two's complement bit the IDE sets. The place is named once,
        // through one `&mut`: printed on both sides, an index holding a call ran that call twice (transpiler review
        // 2026-09-15). The value first, as a plain `place = value` evaluates it.
        const one = `(1${rustType(bit.of)} << ${bit.index})`
        // reserved prefix, for the reason the MOD expansion above spells out: `v` and `w` are ordinary IEC
        // identifiers, and a routine's parameters and VAR_TEMPs are Rust locals in the same scope as this block
        this.push(
          `{ let __bit_v = ${this.expr(s.value, slots)}; let __bit_w = &mut ${field}; *__bit_w = if __bit_v { *__bit_w | ${one} } else { *__bit_w & !${one} }; }`,
          indent,
          s.span,
        )
        return
      }
      case "if": {
        this.push(`if ${unparenHead(this.expr(s.cond, slots))} {`, indent, s.span)
        this.block(s.then, slots, indent + 1)
        if (s.else.length > 0) {
          this.push("} else {", indent)
          this.block(s.else, slots, indent + 1)
        }
        this.push("}", indent)
        return
      }
      case "switch": {
        this.push(`match ${unparenHead(this.expr(s.selector, slots))} {`, indent, s.span)
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
        // THE ITERATION CAP, the same one the interpreter enforces (ir.ts). Without it the two backends disagreed
        // about a runaway loop in the worst possible direction: the interpreter threw, the emitted Rust ran
        // forever — and the emitted Rust is what a user runs under `cargo test`, where a hang looks like a slow
        // suite until CI gives up with nothing to show. The counter carries the reserved prefix for the reason
        // the MOD expansion does.
        this.push(`let mut __iter_${frame.n}: u64 = 0;`, indent, s.span)
        const loopLine = this.lines.length
        this.push(`'loop_${frame.n}: loop {`, indent, s.span)
        this.push(`__iter_${frame.n} += 1;`, indent + 1)
        this.push(
          `if __iter_${frame.n} > ${LOOP_ITERATION_CAP} { panic!(${JSON.stringify(LOOP_CAP_MESSAGE)}); }`,
          indent + 1,
        )
        if (s.test !== undefined && !s.test.atEnd)
          this.push(`if ${this.negated(s.test.cond, slots)} { break; }`, indent + 1)
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
          this.push(`if ${this.negated(s.test.cond, slots)} { break; }`, indent + 1)
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
        this.guardLine(s.instance, slots, indent)
        // a VAR_IN_OUT bound through a dereference is checked too — the interpreter checks it when it binds the argument
        for (const b of s.inouts) if (!("kind" in b)) this.guardLine(b, slots, indent)
        const params = this.layouts.get(s.fb.toUpperCase())?.layout.inouts ?? []
        const bound = [...this.globalsArg, ...s.inouts.map((b, i) => this.lend(b, i, params[i]!, slots)), ...(s.lent ?? []).map((l) => this.lendMut(l, slots))].join(", ")
        const instance = this.place(s.instance, slots)
        const lets = this.lentCopies(s.inouts, slots)
        const back = this.copiesBack(s.inouts, slots)
        // the binding this call makes, which the FB's METHODs called from outside dispatch on (`lower/bindings.ts`)
        if (s.bind !== undefined)
          this.push(`${this.place(s.bind.place, slots)} = ${this.expr({ kind: "const", value: s.bind.tag, type: s.bind.place.type, span: s.span }, slots)};`, indent, s.span)
        // A PROGRAM's instance lives in `Programs`, which the call is handed too — `prg.p.call(g, prg)` would borrow it
        // twice (E0499) — so it runs moved out and back. Lowering refuses a program whose run reaches its own instance.
        if (s.instance.root === "global" && this.globals.slots[s.instance.slot]?.section === "program") {
          // an instance inside the program too (`callshape_program_instance_from_outside`): called on the moved-out value
          const moved = this.movedOut(s.instance, slots)
          this.push(`{ ${lets}${lets === "" ? "" : " "}let mut program = std::mem::take(&mut ${moved.program}); program${moved.member}.call(${bound}); ${moved.program} = program;${back === "" ? "" : ` ${back}`} }`, indent, s.span)
          return
        }
        this.push(lets === "" && back === "" ? `${instance}.call(${bound});` : `{ ${lets} ${instance}.call(${bound}); ${back} }`, indent, s.span)
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
  /** The FB a body runs on — what a `this` place (`THIS^`) walks from. */
  selfType?: Type
}

/** A routine's Rust fn name BEFORE deduping: snake_case, with a keyword or a name the emitter generates itself
 *  (`new`, `call`, `scan`) suffixed `_`. */
function baseFnName(routine: IrRoutine): string {
  const snaked = snake(routine.name.slice(routine.name.lastIndexOf(".") + 1))
  return RUST_KEYWORDS.has(snaked) || ["new", "call", "scan"].includes(snaked) ? `${snaked}_` : snaked
}

/**
 * EVERY ROUTINE'S Rust fn name, deduped across the whole POU — one map, computed once, so the definition and
 * every call site read the SAME answer.
 *
 * `snake` is not injective and ST member names do not have to differ by more than punctuation: a METHOD `DoIt`
 * and a METHOD `Do_It` in one FB are two distinct members that both snake to `do_it`, and the emitter printed
 * TWO `pub fn do_it` into one impl block — E0592, with zero lowering diagnostics, on ST CODESYS compiles. It
 * could not have been fixed inside the old per-routine function, which sees one routine and cannot know what
 * else claimed the name.
 *
 * Deduped in ROUTINE ORDER (`pou.routines`, which is declaration order), because a suffix that moves when an
 * unrelated member is added is the `fieldNames` hazard one file over — a rename nobody asked for, in generated
 * code somebody may be reading.
 */
function routineFnNames(routines: readonly IrRoutine[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  // scoped per impl block: two FBs may each have a `do_it` and never collide
  const used = new Map<string, Set<string>>()
  for (const routine of routines) {
    const scope = routine.fb?.toUpperCase() ?? (routine.kind === "function" ? "(functions)" : "(program)")
    const taken = used.get(scope) ?? new Set<string>()
    used.set(scope, taken)
    const base = baseFnName(routine)
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    out.set(routine.key, name)
  }
  return out
}

/**
 * A METHOD or ACTION as an `fn` in its FB's `impl`, or a FUNCTION as a free `fn`: the inputs are parameters, the VAR_IN_OUT
 * `&mut` parameters, every other local a `let mut` at its initial value — so each call starts over, as measured — and the
 * result local is handed back.
 */
function printRoutine(p: Printer, routine: IrRoutine, fields: readonly string[], fieldSlots: IrPou["slots"], indent: number): void {
  // Every span this routine emits indexes the routine's OWN file, which need not be the main source — a body lowered
  // from a GVL or a library declaration maps to an offset in that file, and a consumer slicing the main one reads the
  // wrong text (or past its end). Restored after, so the POU's own body is not tagged with the last routine's file.
  const outer = p.sourceUri
  p.sourceUri = routine.uri
  // `g` and `prg`, as far as the program has them, are every body's first parameters — no local may take those names
  // INTERNAL: a routine's locals and in-outs are `let` bindings inside a generated fn. Nothing outside reads them, and
  // they legitimately collide with the `g` / `prg` parameters, so these may be renumbered.
  const names = fieldNames([...routine.locals, ...routine.inouts], p.globalsArg, true)
  const localNames = names.slice(0, routine.locals.length)
  const inoutNames = names.slice(routine.locals.length)
  const typed = routine.inouts.map((slot, i) => inoutType(slot, inoutNames[i]!))
  const params = [
    ...(routine.kind === "function" ? [] : ["&mut self"]),
    ...p.globalsParams,
    ...routine.inputs.map((i) => `mut ${localNames[i]}: ${rustType(routine.locals[i]!.type)}`),
    // a VAR_IN_OUT CONSTANT is lent read-only — rustc refuses a write through it, as CODESYS does
    ...typed.map((t) => t.param),
    // each FB instance of another frame the routine is lent for the call (design §24)
    ...(routine.lent ?? []).map((l, i) => `__lent_${i}: &mut ${rustType(l.type)}`),
  ]
  const result = routine.result === undefined ? undefined : localNames[routine.result]!
  const returns = routine.result === undefined ? "" : ` -> ${rustType(routine.locals[routine.result]!.type)}`
  p.push("", 0)
  // THE ALLOW LIST IS THE GATE'S BLIND SPOT, so it is only as wide as it has to be. Every generated function
  // used to carry `unreachable_code` and `non_snake_case` as well, which made `-D warnings` deny almost
  // nothing — and `unreachable_code` is the class the emitter has ALREADY paid for once (see the note at the
  // `panic!` arm: it made the match `!`-typed). Measured by dropping each in turn against the crate check and
  // against CamelCase ST: both come off clean — `rustName` already snake-cases every identifier, and the
  // struct carries its own `non_camel_case_types`.
  //
  // The three that stay are structural, not stylistic. Generated code binds what a body might not read
  // (`unused_variables`), takes `mut` it might not need (`unused_mut`), and initialises a slot a body then
  // overwrites (`unused_assignments`) — each verified load-bearing by the same experiment.
  // …and `unreachable_code` PER ROUTINE, only where the ST itself put a statement after a RETURN. That is legal
  // ST and CODESYS compiles it (`xo4_return_in_every_routine`), so emitting the dead tail is FAITHFUL and the
  // warning is rustc noticing something true about the SOURCE rather than about the emitter. Kept narrow so the
  // lint still bites everywhere else, which is the whole reason the blanket allow came off.
  const allows = ["unused_mut", "unused_variables", "unused_assignments"]
  if (hasStatementAfterReturn(routine.body)) allows.push("unreachable_code")
  p.push(`#[allow(${allows.join(", ")})]`, indent)
  p.push(`pub fn ${p.fnNames.get(routine.key)!}${genericList(typed)}(${params.join(", ")})${returns} {`, indent)
  for (const [i, slot] of routine.locals.entries())
    if (!routine.inputs.includes(i)) p.push(`let mut ${localNames[i]}: ${rustType(slot.type)} = ${p.initOf(slot.type, slot.init)};`, indent + 1)
  const frame: Frame = {
    inoutNames,
    inoutSlots: routine.inouts,
    localNames,
    localSlots: routine.locals,
    ...(result === undefined ? {} : { result }),
    ...(routine.fb === undefined ? {} : { selfType: { kind: "function_block", name: routine.fb } }),
  }
  p.inFrame(fields, frame, () => p.block(routine.body, fieldSlots, indent + 1))
  if (result !== undefined) p.push(result, indent + 1)
  p.push("}", indent)
  p.sourceUri = outer

}

/**
 * A variable path as the IDE names it (`inst.q`, `arr[2].x`) → the Rust field access under a POU value, and the
 * variable's type — how a test reads the emitted program exactly where the interpreter's `get` reads. `global`: the path
 * reaches an FB's VAR_STAT through an instance, and `expr` is then under the `Globals` value.
 */
export function rustAccess(pou: IrPou, path: string): { expr: string; type: Type; global: boolean } {
  // `a[1, 2]` indexes two dimensions: one step each, as `a[1][2]` would
  const parts = [...path.matchAll(/(`[^`]+`|[A-Za-z_]\w*)|\[([^\]]+)\]/g)].flatMap((m) =>
    m[2] === undefined ? [m] : m[2].split(",").map((index) => [m[0], undefined, index.trim()] as unknown as RegExpExecArray),
  )
  const bare = (n: string | undefined): string | undefined => n?.replace(/^`|`$/g, "").toUpperCase()
  const slot = pou.slots.findIndex((s) => bare(s.name) === bare(parts[0]?.[1]))
  if (slot < 0) throw new Error(`no variable ${path} in ${pou.name}`)
  let expr = fieldNames(pou.slots)[slot]!
  let type = pou.slots[slot]!.type
  let global = false
  for (const part of parts.slice(1)) {
    if (part[1] !== undefined) {
      const typeName = type.kind === "struct" || type.kind === "function_block" ? type.name.toUpperCase() : undefined
      const layout = pou.layouts.find((l) => l.name.toUpperCase() === typeName)
      const i = layout?.fields.findIndex((f) => bare(f.name) === bare(part[1])) ?? -1
      const shared = i < 0 ? layout?.statics?.find((s) => bare(s.name) === bare(part[1])) : undefined
      if (shared !== undefined) {
        // an FB's VAR_STAT is a field of `Globals`, named as `emitRust` names the GVL variables
        const variables = pou.globals.filter((s) => s.section !== "program")
        expr = fieldNames(variables)[variables.indexOf(pou.globals[shared.global]!)]!
        type = pou.globals[shared.global]!.type
        global = true
        continue
      }
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
  return { expr, type, global }
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
  const p = new Printer(fields, layouts, new Map(pou.routines.map((r) => [r.key, r])), routineFnNames(pou.routines), { access, slots: pou.globals }, usesGlobals, usesPrograms)
  const name = rustName(pou.name)
  // every generated body is handed the globals as `g`, so no parameter or local of its own may take that name
  const globalsParam = p.globalsParams
  const reserved = [...(usesGlobals ? ["g"] : []), ...(usesPrograms ? ["prg"] : [])]

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
    for (const [i, slot] of slots.entries()) p.push(`${names[i]}: ${p.initOf(slot.type, slot.init)},`, 3)
    p.push("}", 2)
    p.push("}", 1)
    p.push("}", 0)
    p.push("", 0)
    defaultImpl(p, struct)
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
    for (const [i, field] of layout.fields.entries()) p.push(`${names[i]}: ${p.initOf(field.type, field.init)},`, 3)
    p.push("}", 2)
    p.push("}", 1)
    if (layout.body !== undefined) {
      const inouts = layout.inouts ?? []
      const inoutNames = fieldNames(inouts, reserved, true) // parameters of a generated fn, not a surface a user reads
      const lentParams = (layout.lent ?? []).map((l, i) => `__lent_${i}: &mut ${rustType(l.type)}`)
      const typed = inouts.map((slot, i) => inoutType(slot, inoutNames[i]!))
      const params = [...globalsParam, ...typed.map((t) => t.param), ...lentParams].map((param) => `, ${param}`).join("")
      p.push("", 0)
      // an in-out the body leaves to SUPER^ (or never reads) is unused too (review of the copy-back)
      if (globalsParam.length > 0 || inouts.length > 0 || lentParams.length > 0) p.push("#[allow(unused_variables)]", 1)
      p.push(`pub fn call${genericList(typed)}(&mut self${params}) {`, 1)
      const selfType: Type = { kind: "function_block", name: layout.name }
      // this body's spans index the file it was WRITTEN in, which need not be the main source (an FB declared in a GVL)
      const outerBodyUri = p.sourceUri
      p.sourceUri = layout.bodyUri
      p.inFrame(names, { inoutNames, inoutSlots: inouts, localNames: [], localSlots: [], selfType }, () => p.block(layout.body!, layout.fields, 2))
      p.sourceUri = outerBodyUri
      p.push("}", 1)
    }
    for (const routine of pou.routines.filter((r) => r.fb?.toUpperCase() === layout.name.toUpperCase())) printRoutine(p, routine, names, layout.fields, 1)
    p.push("}", 0)
    p.push("", 0)
    defaultImpl(p, rustName(layout.name))
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
  for (const [i, slot] of pou.slots.entries()) p.push(`${fields[i]}: ${p.initOf(slot.type, slot.init)},`, 3)
  p.push("}", 2)
  p.push("}", 1)
  p.push("", 0)
  // once, before the first scan: each instance's `call_after_global_init_slot` method (IrPou.init) — only a POU that has one
  if (pou.init !== undefined) {
    p.push("#[allow(unused_variables)]", 1)
    p.push(`pub fn init(&mut self${usesGlobals ? ", g: &mut Globals" : ""}${usesPrograms ? ", prg: &mut Programs" : ""}) {`, 1)
    p.block(pou.init, pou.slots, 2)
    p.push("}", 1)
    p.push("", 0)
  }
  // a global only `init` reads — an FB_Init argument — leaves `g` unused in the scan (found in a review, 2026-09-15)
  if (usesGlobals || usesPrograms) p.push("#[allow(unused_variables)]", 1)
  p.push(`pub fn scan(&mut self${usesGlobals ? ", g: &mut Globals" : ""}${usesPrograms ? ", prg: &mut Programs" : ""}) {`, 1)
  p.block(pou.body, pou.slots, 2)
  p.push("}", 1)
  p.push("}", 0)
  p.push("", 0)
  defaultImpl(p, name)
  // a FUNCTION has no instance: a free fn beside the structs
  for (const routine of pou.routines.filter((r) => r.kind === "function")) printRoutine(p, routine, [], [], 0)
  // the one check every dereference makes: a null pointer stops the program, as it stops the CODESYS application
  if (p.code.includes("iec_deref(")) {
    p.push("", 0)
    p.push('fn iec_deref(at: usize) { if at == 0 { panic!("dereference of a null pointer"); } }', 0)
  }
  // The emitted twin of `arith`'s zero-divisor check. Gated on its OWN use, not on `iec_deref`'s — a program can
  // divide by zero without ever dereferencing a pointer, and attaching it to the wrong condition left the helper
  // undefined in every program that does.
  // The two halves of the measured REAL -> INTEGER table. See `coerce` in `ir/values.ts`.
  if (p.code.includes("iec_r2i64(")) {
    p.push("", 0)
    p.push("fn iec_r2i64(v: f64) -> i64 {", 0)
    p.push("let c = if v < 0.0 { -((-v).round()) } else { v.round() };", 1)
    p.push("if c.is_nan() || !(-9223372036854775808.0..18446744073709551616.0).contains(&c) { return i64::MIN; }", 1)
    p.push("if c >= 9223372036854775808.0 { return (c as u64) as i64; }", 1)
    p.push("c as i64", 1)
    p.push("}", 0)
  }
  if (p.code.includes("iec_r2i32(")) {
    p.push("", 0)
    p.push("fn iec_r2i32(v: f64) -> i32 {", 0)
    p.push("let c = if v < 0.0 { -((-v).round()) } else { v.round() };", 1)
    p.push("if c.is_nan() { return 0; }", 1)
    p.push("if c < -2147483648.0 { return i32::MIN; }", 1)
    p.push("if c >= 9223372036854775808.0 { return 0; }", 1)
    p.push("(c as i64) as i32", 1)
    p.push("}", 0)
  }
  if (p.code.includes("iec_log(")) {
    p.push("", 0)
    p.push('fn iec_log(x: f64) -> f64 { if x == 0.0 { panic!("the logarithm of zero stops the task on CODESYS"); } x }', 0)
  }
  if (p.code.includes("iec_div(")) {
    p.push("", 0)
    p.push(
      'fn iec_div<T: Copy + PartialEq + Default + std::ops::Div<Output = T>>(a: T, b: T) -> T { if b == T::default() { panic!("division by zero"); } a / b }',
      0,
    )
  }

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
