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
import type { IrExpr, IrPou, IrStmt, IrValue } from "../../ir/index.js"
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
  if (family === "string") return "String"
  // int · bitstring · time · date all carry a width; TIME is nanoseconds in an i64.
  if (family === "int" || family === "bitstring") return `${signed ? "i" : "u"}${bits}`
  return "i64"
}

/** ST names are PascalCase/mixed; Rust fields are snake_case. Mechanical, and stable across runs. */
export function snake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
}

function literal(v: IrValue, t: Type): string {
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "string") return `String::from(${JSON.stringify(v)})`
  return `${v}${t.kind === "elementary" ? rustType(t) : ""}`.replace(/^(-?\d+)(f\d\d)$/, "$1.0$2")
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
      case "load":
        return `self.${snake(slots[e.place.slot]!.name)}`
      case "convert":
        return `(${this.expr(e.value, slots)} as ${rustType(e.type)})`
      case "unary":
        return e.op === "neg"
          ? `(-${this.expr(e.operand, slots)})`
          : `(${e.type.kind === "elementary" && e.type.elem.family === "bool" ? "!" : "!"}${this.expr(e.operand, slots)})`
      case "binary": {
        const l = this.expr(e.left, slots)
        const r = this.expr(e.right, slots)
        const infix = INFIX[e.op]
        if (infix !== undefined) return `(${l} ${infix} ${r})`
        if (e.op === "pow") return `${l}.pow(${r} as u32)`
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
      case "assign":
        this.push(`self.${snake(slots[s.target.slot]!.name)} = ${this.expr(s.value, slots)};`, indent, s.span)
        return
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

  return { code: p.code, sourceMap: p.sourceMap }
}

function defaultLiteral(t: Type): string {
  if (t.kind !== "elementary") return "Default::default()"
  if (t.elem.family === "bool") return "false"
  if (t.elem.family === "real") return "0.0"
  if (t.elem.family === "string") return "String::new()"
  return "0"
}
