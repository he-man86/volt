/**
 * AST → IR. The ONLY place ST semantics are decided; every backend downstream is a printer.
 *
 * Lowering is **total**: it never throws. A construct it cannot represent becomes a `LowerDiagnostic` with a
 * stable code and the POU lowers to nothing — so an untestable POU is reported, never silently wrong, and
 * `scripts/lower-completeness.ts` can count exactly what blocks the corpus.
 *
 * It resolves names and types by CONSUMING the frontend, never by re-deriving:
 *   names   → `symbols/` (`lookup`) decides what an identifier IS; lowering decides only where it lives
 *   types   → `types/` (`resolveTypeExpr`, `inferExprType`) — the IR carries the resulting `Type` itself
 *   consts  → `types/` (`constEval`) folds initializers and CASE labels
 *   IEC facts → `types/elementary` (bits · signed · family · rank), the source of truth a backend maps from
 *
 * ponytail: the executable core only — assignment, expressions, IF/CASE, the three loops. Calls, arrays,
 * structs, pointers and FB instances each report their own code and are counted, not guessed at.
 */
import {
  isGraphicalBody,
  parseSource,
  parseStatements,
  type Expr,
  type Identifier,
  type Span,
  type Statement,
  type StatementList,
  type TopLevel,
  type TypeExpr,
  type VarSection,
} from "../../syntax/index.js"
import { buildSymbolTable, lookup, scopeForUnit, type Scope } from "../../symbols/index.js"
import {
  constEval,
  elementaryType,
  inferExprType,
  resolveTypeExpr,
  UNKNOWN,
  type ElementaryType,
  type Type,
} from "../../types/index.js"
import type {
  IrArm,
  IrBinOp,
  IrExpr,
  IrPou,
  IrSlot,
  IrStmt,
  IrValue,
  LowerDiagnostic,
  LoweredPou,
  Place,
} from "../ir/index.js"

/** ST binary operators → IR opcodes. A name a backend never has to interpret. */
const BIN_OPS: Readonly<Record<string, IrBinOp>> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  MOD: "mod",
  "**": "pow",
  "=": "eq",
  "<>": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  AND: "and",
  "&": "and",
  OR: "or",
  XOR: "xor",
  AND_THEN: "and_then",
  OR_ELSE: "or_else",
}

const COMPARISONS: ReadonlySet<IrBinOp> = new Set(["eq", "ne", "lt", "le", "gt", "ge"])

class Lowering {
  readonly diagnostics: LowerDiagnostic[] = []
  private readonly slots: IrSlot[] = []
  private readonly byName = new Map<string, number>()

  constructor(
    private readonly scope: Scope,
    private readonly project: Scope,
  ) {}

  bail(code: string, message: string, span: Span): undefined {
    this.diagnostics.push({ code, message, span })
    return undefined
  }

  get frame(): readonly IrSlot[] {
    return this.slots
  }

  // ─── slots ─────────────────────────────────────────────────────────────────

  declare(sections: readonly VarSection[]): void {
    for (const sec of sections)
      for (const decl of sec.decls) {
        const type = this.resolve(decl.type)
        if (decl.init?.kind === "aggregate_init") {
          this.bail("aggregate-init", "an aggregate initializer is not lowered yet", decl.init.span)
          continue
        }
        const init = decl.init === undefined ? undefined : this.constant(decl.init)
        for (const name of decl.names) this.slot(name, type, sec.sectionKind, init)
      }
  }

  /** A lowering-owned slot, invisible to ST — a FOR bound evaluated once, and nothing else so far. */
  temp(name: string, type: Type): number {
    this.slots.push({ name, type, section: "temp" })
    return this.slots.length - 1
  }

  private slot(name: Identifier, type: Type, section: VarSection["sectionKind"], init?: IrValue): void {
    this.byName.set(name.text.toUpperCase(), this.slots.length)
    this.slots.push({ name: name.text, type, section, ...(init === undefined ? {} : { init }) })
  }

  private resolve(t: TypeExpr): Type {
    return resolveTypeExpr(t, this.project)
  }

  private constant(e: Expr): IrValue | undefined {
    const v = constEval(e, this.scope)
    return v === undefined ? undefined : v
  }

  // ─── places ────────────────────────────────────────────────────────────────

  place(e: Expr): Place | undefined {
    if (e.kind !== "ident_expr")
      return this.bail("place-shape", `${e.kind} is not a lowerable storage location yet`, e.span)
    const slot = this.byName.get(e.name.toUpperCase())
    if (slot === undefined) {
      // `symbols/` decides what the name IS — a GVL, an enum member, a library global — so the report names
      // the real reason rather than "unknown identifier".
      const found = lookup(this.scope, e.name)?.symbol
      const what = found === undefined ? "does not resolve" : `is a ${found.kind}, which has no frame slot yet`
      return this.bail("place-not-local", `${e.name} ${what}`, e.span)
    }
    return { slot, path: [], type: this.slots[slot]!.type, span: e.span }
  }

  // ─── expressions ───────────────────────────────────────────────────────────

  /**
   * Lower one expression to a node with a DEFINITE type.
   *
   * `inferExprType` answers the LSP's question — "what can I safely say this is?" — and returns `UNKNOWN`
   * wherever a wrong answer would be a false positive (`REAL + INT` among them). A backend cannot emit
   * `UNKNOWN`, so the operator types are computed here from the operand types, over the SAME widening lattice
   * `types/elementary` owns (family + rank). Inference still answers the leaves. An expression that lands on
   * `UNKNOWN` anyway is a reported gap, never untyped IR.
   */
  expr(e: Expr, expected?: Type): IrExpr | undefined {
    switch (e.kind) {
      case "literal": {
        const v = e.value
        if (v === undefined) return this.bail("bad-literal", `malformed literal ${e.text}`, e.span)
        // An IEC integer literal has NO intrinsic type — it takes the one the context requires, which is
        // exactly why `inferExprType` returns UNKNOWN for it. Context first; the narrowest type that holds
        // the value otherwise, so a bare literal still meets its neighbour cleanly.
        const type = literalType(e, expected)
        if (type === UNKNOWN) return this.bail("type-unknown", `the type of ${e.text} is not resolvable`, e.span)
        return retype({ kind: "const", value: typeof v === "object" ? v.ns : v, type, span: e.span }, type)
      }
      case "ident_expr": {
        const place = this.place(e)
        if (place === undefined) return undefined
        if (place.type === UNKNOWN) return this.bail("type-unknown", `the type of ${e.name} is not resolvable`, e.span)
        return { kind: "load", place, type: place.type, span: e.span }
      }
      case "paren":
        return this.expr(e.inner, expected)
      case "unary": {
        if (e.op === "+") return this.expr(e.operand, expected)
        if (e.op !== "-" && e.op !== "NOT") return this.bail("unary-op", `unary ${e.op}`, e.span)
        const operand = this.expr(e.operand, expected)
        // Both ST unary operators are type-preserving: `-x` and `NOT x` are the type of `x`.
        return operand && { kind: "unary", op: e.op === "-" ? "neg" : "not", operand, type: operand.type, span: e.span }
      }
      case "binary": {
        const op = BIN_OPS[e.op]
        if (op === undefined) return this.bail("binary-op", `operator ${e.op}`, e.span)
        // Operands type EACH OTHER, never the surrounding context. `rate := n / 2` with `n : INT` divides in
        // INT and converts the RESULT — propagating REAL inward would quietly turn 3 into 3.5, which is a
        // different program. The context reaches a literal only when there is no typed operand to meet.
        let left = this.expr(e.left)
        if (left === undefined) return undefined
        let right = this.expr(e.right, left.kind === "const" ? undefined : left.type)
        if (right === undefined) return undefined
        if (left.kind === "const" && right.kind !== "const") left = retype(left, right.type)
        else if (right.kind === "const" && left.kind !== "const") right = retype(right, left.type)
        else if (left.kind === "const" && right.kind === "const" && expected !== undefined) {
          // ponytail: an ALL-constant expression takes the context's type, so `x : REAL := 7 / 2` divides in
          // REAL. Which vendors actually do here is unverified — check against a live build before relying
          // on it; every case with a variable operand is decided above and is not affected.
          left = retype(left, expected)
          right = retype(right, expected)
        }
        const meet = wider(left.type, right.type)
        if (meet === UNKNOWN) return this.bail("type-unknown", `the operands of ${e.op} have no common type`, e.span)
        const type = COMPARISONS.has(op) ? boolType() : meet
        return { kind: "binary", op, left: convert(left, meet), right: convert(right, meet), type, span: e.span }
      }
      default:
        return this.bail(`expr-${e.kind}`, `${e.kind} is not lowered yet`, e.span)
    }
  }

  // ─── statements ────────────────────────────────────────────────────────────

  block(list: StatementList): IrStmt[] {
    const out: IrStmt[] = []
    for (const s of list) {
      const lowered = this.stmt(s)
      if (lowered !== undefined) out.push(lowered)
    }
    return out
  }

  stmt(s: Statement): IrStmt | undefined {
    switch (s.kind) {
      case "empty":
        return undefined
      case "assign": {
        if (s.op !== undefined) return this.bail("assign-op", `${s.op} assignment`, s.span)
        if (s.chained !== undefined) return this.bail("assign-chained", "a chained assignment", s.span)
        const target = this.place(s.target)
        const value = target === undefined ? undefined : this.expr(s.value, target.type)
        return target && value ? { kind: "assign", target, value: convert(value, target.type), span: s.span } : undefined
      }
      case "if": {
        // ELSIF is an ELSE holding one nested IF — one shape for the backend, not a branch list.
        const build = (i: number): IrStmt | undefined => {
          const branch = s.branches[i]
          if (branch === undefined) return undefined
          const cond = this.expr(branch.cond, boolType())
          if (cond === undefined) return undefined
          const rest = build(i + 1)
          const otherwise = rest !== undefined ? [rest] : s.elseBody ? this.block(s.elseBody) : []
          return { kind: "if", cond, then: this.block(branch.body), else: otherwise, span: branch.span }
        }
        return build(0)
      }
      case "case": {
        const selector = this.expr(s.selector)
        if (selector === undefined) return undefined
        const arms: IrArm[] = []
        for (const arm of s.arms) {
          const labels: { lo: IrValue; hi: IrValue }[] = []
          for (const label of arm.labels) {
            const lo = this.constant(label.value)
            const hi = label.upper === undefined ? lo : this.constant(label.upper)
            if (lo === undefined || hi === undefined) {
              this.bail("case-label", "a CASE label that is not a compile-time constant", label.span)
              return undefined
            }
            labels.push({ lo, hi })
          }
          arms.push({ labels, body: this.block(arm.body), span: arm.span })
        }
        return {
          kind: "switch",
          selector,
          arms,
          else: s.elseBody ? this.block(s.elseBody) : [],
          span: s.span,
        }
      }
      case "for":
        return this.forLoop(s)
      case "while": {
        const cond = this.expr(s.cond, boolType())
        return cond && { kind: "loop", init: [], test: { cond, atEnd: false }, body: this.block(s.body), step: [], span: s.span }
      }
      case "repeat": {
        // REPEAT runs until its condition holds; the IR's test is "keep going", so it is negated here.
        const until = this.expr(s.until, boolType())
        if (until === undefined) return undefined
        const cond: IrExpr = { kind: "unary", op: "not", operand: until, type: until.type, span: until.span }
        return { kind: "loop", init: [], test: { cond, atEnd: true }, body: this.block(s.body), step: [], span: s.span }
      }
      case "exit":
        return { kind: "break", span: s.span }
      case "continue":
        return { kind: "continue", span: s.span }
      case "return":
        return { kind: "return", span: s.span }
      default:
        return this.bail(`stmt-${s.kind}`, `${s.kind} is not lowered yet`, s.span)
    }
  }

  /**
   * FOR → the one loop shape. IEC evaluates the limit and the step ONCE, before the first iteration, so both
   * go into temp slots; re-reading them each pass would be a different program.
   */
  private forLoop(s: Extract<Statement, { kind: "for" }>): IrStmt | undefined {
    const control = this.place(s.controlVar)
    if (control === undefined) return undefined
    const from = this.expr(s.from, control.type)
    const to = this.expr(s.to, control.type)
    if (from === undefined || to === undefined) return undefined

    const by = s.by === undefined ? undefined : this.expr(s.by, control.type)
    if (s.by !== undefined && by === undefined) return undefined
    const step: IrValue | undefined = s.by === undefined ? 1n : this.constant(s.by)
    if (step === undefined)
      // A runtime BY makes the loop's DIRECTION runtime too, so the test becomes a two-armed condition.
      // Nothing here needs it yet, and guessing `<=` would silently run zero times for a negative step.
      return this.bail("for-step-runtime", "a FOR step that is not a compile-time constant", s.by!.span)

    const limit = this.temp("for_limit", to.type)
    const limitPlace: Place = { slot: limit, path: [], type: to.type, span: s.to.span }
    const stepExpr: IrExpr = { kind: "const", value: step, type: control.type, span: s.by?.span ?? s.span }

    return {
      kind: "loop",
      init: [
        { kind: "assign", target: limitPlace, value: convert(to, to.type), span: s.to.span },
        { kind: "assign", target: control, value: convert(from, control.type), span: s.from.span },
      ],
      test: {
        cond: {
          kind: "binary",
          op: Number(step) >= 0 ? "le" : "ge",
          left: { kind: "load", place: control, type: control.type, span: s.controlVar.span },
          right: { kind: "load", place: limitPlace, type: to.type, span: s.to.span },
          type: boolType(),
          span: s.span,
        },
        atEnd: false,
      },
      body: this.block(s.body),
      step: [
        {
          kind: "assign",
          target: control,
          value: {
            kind: "binary",
            op: "add",
            left: { kind: "load", place: control, type: control.type, span: s.controlVar.span },
            right: stepExpr,
            type: control.type,
            span: s.span,
          },
          span: s.span,
        },
      ],
      span: s.span,
    }
  }
}

// ─── type helpers (facts come from `types/elementary`, never from a second table) ─────────────────────────

function elem(t: Type): ElementaryType | undefined {
  return t.kind === "elementary" ? t.elem : undefined
}

function boolType(): Type {
  const b = elementaryType("BOOL")!
  return { kind: "elementary", name: "BOOL", elem: b }
}

/**
 * The common type two operands meet at — IEC numeric widening over the rank `types/elementary` already owns.
 * Non-numeric operands (BOOL, STRING, TIME) have no lattice: they meet only with their own kind.
 */
function wider(a: Type, b: Type): Type {
  const ea = elem(a)
  const eb = elem(b)
  if (ea === undefined || eb === undefined) return UNKNOWN
  if (ea.name === eb.name) return a
  if (ea.rank === undefined || eb.rank === undefined) return UNKNOWN
  // REAL absorbs any integer; otherwise the wider rank within the same family wins.
  if (ea.family === "real") return eb.family === "real" ? (ea.rank >= eb.rank ? a : b) : a
  if (eb.family === "real") return b
  return ea.rank >= eb.rank ? a : b
}

/** Wrap in an explicit conversion when the types differ — a backend never widens on its own. */
function convert(e: IrExpr, to: Type): IrExpr {
  const from = elem(e.type)
  const target = elem(to)
  if (from === undefined || target === undefined || from.name === target.name) return e
  // Retyping a constant is free and leaves cleaner output than converting it at run time.
  if (e.kind === "const") return retype(e, to)
  return { kind: "convert", value: e, type: to, span: e.span }
}

/** Re-stamp a constant with a type, moving its value across the int/real divide if that is what changed. */
function retype(e: IrExpr, to: Type): IrExpr {
  if (e.kind !== "const") return e
  const target = elem(to)
  if (target === undefined) return e
  const value =
    target.family === "real" && typeof e.value === "bigint"
      ? Number(e.value)
      : target.family !== "real" && typeof e.value === "number" && Number.isInteger(e.value)
        ? BigInt(e.value)
        : e.value
  return { ...e, value, type: to }
}

/** The type an IEC literal takes: the context's, or the narrowest that holds the value. */
function literalType(e: Extract<Expr, { kind: "literal" }>, expected?: Type): Type {
  const want = elem(expected ?? UNKNOWN)
  const v = e.value
  if (v === undefined) return UNKNOWN
  if (typeof v === "boolean") return named("BOOL")
  if (typeof v === "string") return named(e.literalKind === "wstring" ? "WSTRING" : "STRING")
  if (typeof v === "object") return named("TIME") // a duration, normalized to nanoseconds
  if (typeof v === "number") return want?.family === "real" ? expected! : named("LREAL")
  // An integer literal: honour a numeric context (REAL included — `x : REAL := 1;` is legal), else narrowest.
  if (want !== undefined && want.rank !== undefined) return expected!
  for (const name of ["SINT", "INT", "DINT", "LINT"]) {
    const t = elementaryType(name)!
    if (t.range !== undefined && v >= t.range.min && v <= t.range.max) return named(name)
  }
  return named("LINT")
}

function named(name: string): Type {
  const e = elementaryType(name)
  return e === undefined ? UNKNOWN : { kind: "elementary", name: e.name, elem: e }
}

// ─── entry points ────────────────────────────────────────────────────────────

/** Lower one already-bound unit. The workspace path: the caller owns the project scope and its index. */
export function lowerUnit(unit: TopLevel, scope: Scope, project: Scope): LoweredPou {
  if (unit.kind !== "program" && unit.kind !== "function_block")
    return { diagnostics: [{ code: "unit-kind", message: `${unit.kind} is not lowered yet`, span: unit.span }] }

  // A graphical body holds no statements, so `parseStatements` returns an empty list rather than an error —
  // which would lower to a POU that "succeeds" and does nothing. Refuse it explicitly; FBD/LD reach the
  // backend through network text, not through here.
  if (isGraphicalBody(unit.body))
    return { diagnostics: [{ code: "graphical-body", message: "a graphical body is not lowered here", span: unit.span }] }

  const lowering = new Lowering(scope, project)
  lowering.declare(unit.varSections)
  const parsed = parseStatements(unit.body)
  if (!parsed.ok)
    return { diagnostics: [{ code: "parse", message: parsed.firstError ?? "body did not parse", span: unit.span }] }

  const body = lowering.block(parsed.statements)
  if (lowering.diagnostics.length > 0) return { diagnostics: lowering.diagnostics }

  const pou: IrPou = { name: unit.name.text, slots: lowering.frame, body, span: unit.span }
  return { pou, diagnostics: [] }
}

/** Parse, bind and lower one source string. The test/CLI path. */
export function lowerSource(source: string, name?: string): LoweredPou {
  const parseResult = parseSource(source)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [{ code: "parse", message: first.message, span: first.span }] }
  }
  const project = buildSymbolTable([{ uri: "transpile://source", parseResult, source }])
  const runnable = (u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> =>
    u.kind === "program" || u.kind === "function_block"
  const unit = parseResult.units
    .filter(runnable)
    .find((u) => name === undefined || u.name.text.toUpperCase() === name.toUpperCase())
  if (unit === undefined) {
    const span = parseResult.units[0]?.span ?? { start: 0, end: 0, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
    return { diagnostics: [{ code: "no-unit", message: `no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}`, span }] }
  }
  const scope = scopeForUnit(project, unit)
  if (scope === undefined)
    return { diagnostics: [{ code: "no-scope", message: `${unit.name.text} did not bind`, span: unit.span }] }
  return lowerUnit(unit, scope, project)
}
