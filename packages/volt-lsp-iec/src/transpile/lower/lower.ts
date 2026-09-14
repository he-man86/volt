/**
 * AST → IR. The ONLY place ST semantics are decided; every backend downstream is a printer.
 *
 * Lowering is **total**: it never throws. A construct it cannot represent becomes a `LowerDiagnostic` with a
 * stable code and the POU lowers to nothing — so an untestable POU is reported, never silently wrong, and
 * `scripts/lower-completeness.ts` can count exactly what blocks the corpus.
 *
 * Its input is code CODESYS COMPILES (the contract in `../index.ts`): a rule here exists for valid programs only.
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
  decodeStringLiteral,
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
  commonType,
  constEval,
  DEFAULT_STRING_LENGTH,
  elementaryRef,
  elemOf,
  exptResultType,
  inTypeGroup,
  integerLiteralType,
  isIntegerType,
  literalType,
  promoteForRuntime,
  REAL_LITERAL_TYPE,
  temporalResultType,
  parseConversionName,
  resolveTypeExpr,
  UNKNOWN,
  type Type,
} from "../../types/index.js"
import type {
  IrArm,
  IrBinOp,
  IrBuiltinName,
  IrExpr,
  IrPou,
  IrSlot,
  IrStmt,
  IrValue,
  LowerDiagnostic,
  LoweredPou,
  Place,
} from "../ir/index.js"

/** ST binary operators → IR opcodes. A name a backend never has to interpret. `**` and `&` are absent on purpose: the
 *  parser accepts them (the LSP reports them), but neither is an operator in CODESYS, so they reach `binary-op`. */
const BIN_OPS: Readonly<Record<string, IrBinOp>> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  MOD: "mod",
  "=": "eq",
  "<>": "ne",
  "<": "lt",
  "<=": "le",
  ">": "gt",
  ">=": "ge",
  AND: "and",
  OR: "or",
  XOR: "xor",
  AND_THEN: "and_then",
  OR_ELSE: "or_else",
}

const COMPARISONS: ReadonlySet<IrBinOp> = new Set(["eq", "ne", "lt", "le", "gt", "ge"])

/** The value functions `builtin` lowers, and how many operands each takes. SEL's count includes its selector. */
const BUILTIN_ARITY: Readonly<Record<string, { min: number; max?: number }>> = {
  MAX: { min: 1 },
  MIN: { min: 1 },
  LIMIT: { min: 3, max: 3 },
  SEL: { min: 3, max: 3 },
  TRUNC: { min: 1, max: 1 },
  TRUNC_INT: { min: 1, max: 1 },
  ABS: { min: 1, max: 1 },
  EXPT: { min: 2, max: 2 },
  SHL: { min: 2, max: 2 },
  SHR: { min: 2, max: 2 },
  ROL: { min: 2, max: 2 },
  ROR: { min: 2, max: 2 },
  MUX: { min: 2 },
  ...Object.fromEntries(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"].map((n) => [n, { min: 1, max: 1 }])),
}

/** The Standard library's string functions — lowered only when the callee resolves into that library (`standardString`). */
const STANDARD_STRING_FUNCTIONS: ReadonlySet<string> = new Set(["LEN", "LEFT", "RIGHT", "MID", "CONCAT", "INSERT", "DELETE", "REPLACE", "FIND"])

/** The one-argument math functions — same arity, same typing rule (see `builtin`). */
const UNARY_MATH: ReadonlySet<string> = new Set(["SQRT", "LN", "LOG", "EXP", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN"])

/** The operators whose operands are promoted (see `promoted`). Arithmetic is measured, and so are AND/OR/XOR:
 *  `minus1 AND 255` with `minus1 : SINT := -1` stored into an INT is 255 — the AND happens in DINT, after the -1
 *  sign-extends (test/exec `bitwise_on_narrow_types`). A comparison is included because widening both sides can
 *  never change its answer, while a narrow compare against an out-of-range literal would. Unary NOT is NOT
 *  promoted — `NOT u255` with `u255 : USINT` stored into a DINT is 0 — and it is not a binary operator anyway.
 *  On BOOL operands `promoted` is the identity, so AND/OR/XOR on BOOLs are untouched. */
const LIFTED: ReadonlySet<IrBinOp> = new Set([...COMPARISONS, "add", "sub", "mul", "div", "mod", "and", "or", "xor"])

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
        const type = withStringCapacity(this.resolve(decl.type))
        if (decl.init?.kind === "aggregate_init") {
          this.bail("aggregate-init", "an aggregate initializer is not lowered yet", decl.init.span)
          continue
        }
        // The folded value takes the SLOT's type: `x : REAL := 7 / 2` folds to the integer 3 and is stored as REAL 3.
        // Left as-is, a REAL slot started life holding a bigint.
        // `constEval` folds only numbers and booleans — a duration or date literal came back undefined, so every
        // `t : TIME := T#1S` / `d : DATE := D#…` slot silently started at 0. They fold here, in their type's unit.
        const temporal = decl.init?.kind === "literal" ? (durationOf(decl.init) ?? calendarOf(decl.init) ?? typedRealOf(decl.init)) : undefined
        // `constEval` does not fold strings either: every `s : STRING := 'abc'` started empty (test/exec `string_*`).
        const text = decl.init?.kind === "literal" && typeof decl.init.value === "string" ? this.text(decl.init) : undefined
        if (text === null) continue
        const folded = temporal?.value ?? text ?? (decl.init === undefined ? undefined : this.constant(decl.init))
        // An initializer that does not fold is REPORTED — it used to be dropped, so the slot silently started at its
        // default. That is how every string slot lost its value without one lowering diagnostic.
        if (decl.init !== undefined && folded === undefined) {
          this.bail("init-not-constant", "an initial value that is not a compile-time constant", decl.init.span)
          continue
        }
        const init = folded === undefined ? undefined : valueAs(folded, type)
        for (const name of decl.names) this.slot(name, type, sec.sectionKind, init)
      }
  }

  /**
   * A lowering-owned slot, invisible to ST — a FOR bound evaluated once, a chain's value. Its name is UNIQUE and
   * starts with `__`, which CODESYS reserves, so no user variable can take it. It used to be the bare purpose: two FOR
   * loops in one POU made two `for_limit` fields — a Rust struct rustc rejects — and a variable the user called
   * `for_limit` would have collided with the temp. The interpreter reads slots by index, so only the emitter noticed.
   */
  temp(name: string, type: Type): number {
    this.slots.push({ name: `__${name}_${this.slots.length}`, type, section: "temp" })
    return this.slots.length - 1
  }

  private slot(name: Identifier, type: Type, section: VarSection["sectionKind"], init?: IrValue): void {
    this.byName.set(name.text.toUpperCase(), this.slots.length)
    this.slots.push({ name: name.text, type, section, ...(init === undefined ? {} : { init }) })
  }

  private resolve(t: TypeExpr): Type {
    return resolveTypeExpr(t, this.project)
  }

  /** A string literal's decoded text, or null (reported) when it holds an escape not measured yet. */
  private text(e: Extract<Expr, { kind: "literal" }>): string | null {
    const wide = e.literalKind === "wstring"
    const decoded = decodeStringLiteral(e.value as string, wide)
    if (decoded === undefined) {
      this.bail("string-escape", `${e.text} holds a \`$\` escape that is not measured yet`, e.span)
      return null
    }
    // A WSTRING holds UTF-16 code units, one per character: "héllo" into a WSTRING(3) is "hél" and "ü!" fits a
    // WSTRING(2) (test/exec `wstring_code_units`). A character beyond the BMP (two units) is not measured; nor is which
    // byte a non-ASCII character TYPED into a STRING becomes — both refused.
    if (wide ? [...decoded].some((ch) => ch.length > 1) : /[^\x00-\x7f]/.test(e.value as string)) {
      this.bail(wide ? "wstring-surrogate" : "string-non-ascii", `${e.text} holds a character not measured yet`, e.span)
      return null
    }
    return decoded
  }

  private constant(e: Expr): IrValue | undefined {
    const v = constEval(e, this.scope)
    return v === undefined ? undefined : v
  }

  // ─── places ────────────────────────────────────────────────────────────────

  place(e: Expr): Place | undefined {
    if (e.kind === "member") return this.bitPlace(e, "place-shape")
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

  /**
   * `x.3` on a local integer — one bit of one slot, readable and writable (design §14): two's complement, so
   * `im1.15` with `im1 : INT := -1` is TRUE and `i0.15 := TRUE` makes -32768. Any other dotted name is a struct or
   * instance member, which waits on the memory model (§9) — it keeps the counted code the caller passes, so the
   * coverage report's categories do not shift under it.
   */
  private bitPlace(e: Extract<Expr, { kind: "member" }>, notABit: string): Place | undefined {
    const index = /^\d+$/.test(e.member.name) ? Number(e.member.name) : undefined
    if (index === undefined || e.base.kind !== "ident_expr") return this.bail(notABit, "member access is not lowered yet", e.span)
    const base = this.place(e.base)
    if (base === undefined) return undefined
    // A bit of something that is not an integer SLOT says what it is instead: `slice.0` with `slice : REFERENCE TO
    // BYTE` (pro2193 MapperInputs.fb) is aliasing — phase 4 — and a `bit-index` there sent the reader to the wrong phase.
    if (base.type.kind !== "elementary") return this.bail(`bit-on-${base.type.kind}`, `bit ${index} of ${e.base.name}`, e.span)
    const t = base.type.elem
    if (t.rank === undefined || (t.family !== "int" && t.family !== "bitstring") || index >= t.bits)
      return this.bail("bit-index", `bit ${index} of ${e.base.name}`, e.span)
    return { slot: base.slot, path: [{ kind: "bit", index }], type: elementaryRef("BOOL"), span: e.span }
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
        const typed = durationOf(e) ?? calendarOf(e) ?? typedRealOf(e)
        if (typed !== undefined) return { kind: "const", value: typed.value, type: typed.type, span: e.span }
        if (typeof v === "string") {
          const text = this.text(e)
          if (text === null) return undefined
          const base = elementaryRef(e.literalKind === "wstring" ? "WSTRING" : "STRING")
          return { kind: "const", value: text, type: { ...base, length: text.length } as Type, span: e.span }
        }
        // An IEC integer literal has NO intrinsic type — it takes the one the context requires, which is
        // exactly why `inferExprType` returns UNKNOWN for it. Context first; the narrowest type that holds
        // the value otherwise, so a bare literal still meets its neighbour cleanly.
        const type = contextLiteralType(e, expected)
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
        if (operand === undefined) return undefined
        // `NOT x` keeps the type of `x` — `NOT u255` with `u255 : USINT` into a DINT is 0. `-x` does NOT: it promotes
        // like the arithmetic it is — `-sMin` with `sMin : SINT := -128` is 128, `-iMin` with `iMin : INT := -32768`
        // into a DINT is 32768, and a DINT's minimum still negates to itself even into a LINT (test/exec
        // `unary_minus_at_the_edge`). This used to preserve the operand type, and wrapped all three.
        if (e.op === "NOT") return { kind: "unary", op: "not", operand, type: operand.type, span: e.span }
        const type = promoteForRuntime(operand.type)
        return { kind: "unary", op: "neg", operand: convert(operand, type), type, span: e.span }
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
        // Two STRINGs compare as they are, byte by byte — never converted to one capacity first, which would cut the
        // longer one and make 'abc' = 'abcd' TRUE. Measured: 'abc' < 'b' and 'A' < 'a' (test/exec `string_compare`).
        const isString = (x: IrExpr): boolean => {
          const t = elemOf(x.type)
          return t !== undefined && inTypeGroup("ANY_STRING", t)
        }
        if (isString(left) || isString(right)) {
          // Anything else on a STRING does not compile — `'x' + 'y'` is "Cannot convert type 'STRING' to type 'ANY_NUM'"
          // (`string_arithmetic_rejected`) — so this refusal only keeps lowering total.
          if (!COMPARISONS.has(op) || !isString(left) || !isString(right))
            return this.bail("string-op", `operator ${e.op} on a STRING`, e.span)
          return { kind: "binary", op, left, right, type: elementaryRef("BOOL"), span: e.span }
        }
        // BEFORE the constant retyping below: `dt + T#1S` would otherwise stamp the 1000-ms literal as a DT — 1000 s.
        const calendar = calendarArithmetic(op, left, right, e.span)
        if (calendar !== undefined) return calendar
        // Arithmetic and comparison happen in the PROMOTED type (see `promoteForRuntime`), so a literal beside a narrow
        // variable takes that type too — else `si + 1000` would wrap the 1000 into SINT before promoting.
        const lift = LIFTED.has(op) ? promoteForRuntime : (t: Type): Type => t
        if (left.kind === "const" && right.kind !== "const") left = adopt(left, lift(right.type))
        else if (right.kind === "const" && left.kind !== "const") right = adopt(right, lift(left.type))
        else if (left.kind === "const" && right.kind === "const") {
          // An ALL-constant integer expression folds at FULL width and then converts: `i := 100 + 100` is 200 and
          // `li := 2000000000 + 2000000000` is 4000000000 (test/exec `constant_arithmetic_width`). It does not take
          // the context's type either — `x : REAL := 7 / 2` is 3, not 3.5 (`all_constant_division_in_real_context`);
          // this used to retype both sides to the context. LINT is the widest the IR can type.
          if (elemOf(left.type)?.family === "int") left = retype(left, elementaryRef("LINT"))
          if (elemOf(right.type)?.family === "int") right = retype(right, elementaryRef("LINT"))
        }
        // A duration × or ÷ an integer (and an integer × a duration) computes in the duration's type: `T#1S * 3` is
        // T#3S and `T#1S / 4` is T#250MS (test/exec `time_multiply_divide`). A duration has no widening rank, so
        // without this `commonType` would find no common type.
        const isDuration = (t: Type): boolean => elemOf(t)?.family === "time"
        const isIntegral = (t: Type): boolean => isIntegerType(elemOf(t)?.name ?? "")
        if ((op === "mul" || op === "div") && isDuration(left.type) && isIntegral(right.type)) right = convert(right, left.type)
        else if (op === "mul" && isIntegral(left.type) && isDuration(right.type)) left = convert(left, right.type)
        const meet = commonType(left.type, right.type)
        if (meet === UNKNOWN) return this.bail("type-unknown", `the operands of ${e.op} have no common type`, e.span)
        const operands = lift(meet)
        const type = COMPARISONS.has(op) ? elementaryRef("BOOL") : operands
        return { kind: "binary", op, left: convert(left, operands), right: convert(right, operands), type, span: e.span }
      }
      case "call":
        return this.builtin(e)
      case "member": {
        const place = this.bitPlace(e, "expr-member")
        return place && { kind: "load", place, type: place.type, span: e.span }
      }
      default:
        return this.bail(`expr-${e.kind}`, `${e.kind} is not lowered yet`, e.span)
    }
  }

  /**
   * The value functions MAX/MIN/LIMIT/SEL → one `builtin` node. Every rule is MEASURED on CODESYS 3.5.21.40
   * (test/exec `max_*`, `limit_*`, `sel_basic`), not recalled:
   *   - MAX/MIN are extensible — `MAX(1, 5, 3)` is 5, `MIN(8, 4, 6, 9)` is 4;
   *   - the arguments MEET like a binary operator's operands — `MAX(i3, r25)` is REAL 3, and
   *     `MAX(us200, sMinus1)` (USINT 200, SINT -1) is 200, a comparison of VALUES after promotion;
   *   - `LIMIT(MN, IN, MX)` is exactly `MIN(MAX(IN, MN), MX)` — with MN > MX it returns MX for every IN;
   *   - `SEL(G, IN0, IN1)` is IN0 on FALSE, IN1 on TRUE.
   * Any other call — a project function, a library, a conversion — is still `expr-call`, and counted.
   */
  private builtin(e: Extract<Expr, { kind: "call" }>): IrExpr | undefined {
    const name = e.callee.kind === "ident_expr" ? e.callee.name.toUpperCase() : undefined
    // `X_TO_Y` / `TO_Y` — `types/parseConversionName`, the one parser: both names elementary and spelled as CODESYS
    // spells them. A project function called `GO_TO_START` is an ordinary call, and `TIME_OF_DAY_TO_UDINT` is no
    // conversion at all (it is not defined — this used to read it as one).
    const conv = name === undefined ? undefined : parseConversionName(name)
    if (conv !== undefined) return this.conversion(e, conv.from && elementaryRef(conv.from.name), elementaryRef(conv.to.name))
    if (name !== undefined && STANDARD_STRING_FUNCTIONS.has(name)) return this.standardString(e, name)
    const arity = name === undefined ? undefined : BUILTIN_ARITY[name]
    if (name === undefined || arity === undefined) return this.bail("expr-call", "call is not lowered yet", e.span)
    if (e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
      return this.bail("call-named-args", `${name} with named or output arguments`, e.span)
    if (e.args.length < arity.min || (arity.max !== undefined && e.args.length > arity.max))
      return this.bail("call-arity", `${name} with ${e.args.length} arguments`, e.span)

    const values = e.args.map((a) => a.value!)
    if (name === "TRUNC" || name === "TRUNC_INT") {
      const arg = this.expr(values[0]!)
      if (arg === undefined) return undefined
      // Toward zero — TRUNC(-2.7) is -2 — into DINT (TRUNC) or INT (TRUNC_INT). test/exec `trunc_functions`.
      const type = elementaryRef(name === "TRUNC" ? "DINT" : "INT")
      return { kind: "builtin", name: "trunc", args: [arg], type, span: e.span }
    }
    if (name === "ABS") {
      const arg = this.expr(values[0]!)
      if (arg === undefined) return undefined
      // Promotes like unary minus: ABS(SINT -128) is 128, ABS(INT -32768) into a DINT is 32768 and into an INT wraps
      // back to -32768; ABS of a USINT is the value itself (test/exec `abs_values`, `abs_unsigned`).
      const type = promoteForRuntime(arg.type)
      return { kind: "builtin", name: "abs", args: [convert(arg, type)], type, span: e.span }
    }
    if (name === "SHL" || name === "SHR" || name === "ROL" || name === "ROR") {
      const value = this.expr(values[0]!)
      const count = value === undefined ? undefined : this.expr(values[1]!)
      if (value === undefined || count === undefined) return undefined
      // SHL/SHR shift the PROMOTED value — SHL(BYTE 1, 9) into a WORD is 512 — while ROL/ROR rotate in the value's
      // own width: ROL(BYTE 129, 1) is 3 (test/exec `shift_basic`, `rotate_basic`).
      const shift = name === "SHL" || name === "SHR"
      const type = shift ? promoteForRuntime(value.type) : value.type
      const op = name.toLowerCase() as IrBuiltinName
      return { kind: "builtin", name: op, args: [convert(value, type), count], type, span: e.span }
    }
    if (name === "MUX") {
      const index = this.expr(values[0]!)
      if (index === undefined) return undefined
      const inputs: IrExpr[] = []
      for (const v of values.slice(1)) {
        const lowered = this.expr(v)
        if (lowered === undefined) return undefined
        inputs.push(lowered)
      }
      // The inputs meet like MAX's — MUX(0, INT 10, REAL 2.5) is REAL 10 (test/exec `mux_mixed_types`).
      const type = this.meet(inputs, e.span)
      if (type === undefined) return undefined
      return { kind: "builtin", name: "mux", args: [index, ...inputs.map((i) => convert(i, type))], type, span: e.span }
    }
    if (name === "EXPT") {
      const base = this.expr(values[0]!)
      const exponent = base === undefined ? undefined : this.expr(values[1]!)
      if (base === undefined || exponent === undefined) return undefined
      // REAL only when BOTH arguments are REAL — EXPT(REAL 2.0, REAL 0.5) is float32's √2 — and LREAL otherwise:
      // EXPT(REAL 3.0, INT 20) is 3486784401 (float32 would give 3486784512), EXPT(INT 2, REAL 0.5) and
      // EXPT(LREAL, REAL) are float64, and EXPT(INT, INT) is LREAL-typed (into an INT it does not compile).
      // test/exec `expt_types`, `expt_mixed_width`.
      const type = exptResultType(base.type, exponent.type)
      return { kind: "builtin", name: "expt", args: [convert(base, type), convert(exponent, type)], type, span: e.span }
    }
    if (UNARY_MATH.has(name)) {
      const arg = this.expr(values[0]!)
      if (arg === undefined) return undefined
      // A REAL argument computes in REAL — SQRT(REAL 2.0) is float32's 1.4142135381698608 — an LREAL in LREAL, and an
      // INTEGER in LREAL: SQRT(INT 2) is 1.4142135623730951 (test/exec `sqrt_precision`, `exp_log_precision`,
      // `trig_precision`).
      const type = elemOf(arg.type)?.family === "real" ? arg.type : elementaryRef("LREAL")
      const math = name.toLowerCase() as IrBuiltinName
      return { kind: "builtin", name: math, args: [convert(arg, type)], type, span: e.span }
    }
    const selector = name === "SEL" ? this.expr(values[0]!, elementaryRef("BOOL")) : undefined
    if (name === "SEL" && selector === undefined) return undefined
    const operands: IrExpr[] = []
    for (const v of name === "SEL" ? values.slice(1) : values) {
      const lowered = this.expr(v)
      if (lowered === undefined) return undefined
      operands.push(lowered)
    }
    const type = this.meet(operands, e.span)
    if (type === undefined) return undefined
    const args = operands.map((o) => convert(o, type))
    const lower = name.toLowerCase() as IrBuiltinName
    return { kind: "builtin", name: lower, args: selector === undefined ? args : [selector, ...args], type, span: e.span }
  }

  /**
   * A string function of the referenced Standard library → one `builtin` node — a library-gated intrinsic
   * (plc-library-runtime, tier 1). It binds ONLY when the name resolves to that library's own declaration under
   * `Library Manager/Standard/`: a project that references no Standard has no LEN, and a project FUNCTION called LEN is
   * not this one. The signature is the library's, never recalled — every parameter and result is STRING(255) there,
   * so an argument converts to it (and a longer one is cut on the way in) exactly as the compiler passes it.
   */
  private standardString(e: Extract<Expr, { kind: "call" }>, name: string): IrExpr | undefined {
    const sym = lookup(this.scope, name)?.symbol
    if (sym === undefined || sym.ast.kind !== "function" || !/Library Manager[\\/]Standard[\\/]/.test(sym.uri.replace(/%20/g, " ")))
      return this.bail("expr-call", `${name} does not resolve to the Standard library`, e.span)
    const params = sym.ast.varSections
      .filter((s) => s.sectionKind === "VAR_INPUT")
      .flatMap((s) => s.decls.flatMap((d) => d.names.map(() => withStringCapacity(this.resolve(d.type)))))
    const result = sym.ast.returnType === undefined ? UNKNOWN : withStringCapacity(this.resolve(sym.ast.returnType))
    if (e.args.some((a) => a.param !== undefined || a.output || a.value === undefined))
      return this.bail("call-named-args", `${name} with named or output arguments`, e.span)
    if (e.args.length !== params.length || result === UNKNOWN || params.includes(UNKNOWN))
      return this.bail("call-arity", `${name} with ${e.args.length} arguments`, e.span)
    const args: IrExpr[] = []
    for (const [i, a] of e.args.entries()) {
      const arg = this.expr(a.value!, params[i])
      if (arg === undefined) return undefined
      args.push(convert(arg, params[i]!))
    }
    return { kind: "builtin", name: name.toLowerCase() as IrBuiltinName, args, type: result, span: e.span }
  }

  /**
   * `X_TO_Y(v)` / `TO_Y(v)` → an explicit `convert` node. The rules themselves live in that IR node (design §11), so
   * implicit and explicit conversions cannot drift apart. `X_TO_Y` first brings `v` to X the way the compiler
   * would; `TO_Y` converts from whatever `v` is. The explicit step is always a NODE, never a retyped constant:
   * `DINT_TO_SINT(300)` is 44, and a constant stamped SINT would print as Rust's out-of-range `300i8`.
   */
  private conversion(e: Extract<Expr, { kind: "call" }>, from: Type | undefined, to: Type): IrExpr | undefined {
    const scalar = (t: Type): boolean => ["bool", "int", "bitstring", "real", "time", "date"].includes(elemOf(t)?.family ?? "")
    // STRING conversions (design §18): to STRING from an integer, a bit string, BOOL or TIME; from STRING to an integer,
    // REAL or LREAL. REAL_TO_STRING has no single digit rule and stays refused; parsing into a bit string is unmeasured.
    // The result is a sizeless STRING (80) — no text these produce is longer.
    const isInt = (t: Type | undefined, orBits = false): boolean =>
      t !== undefined && (elemOf(t)?.family === "int" || (orBits && elemOf(t)?.family === "bitstring"))
    const isString = (t: Type | undefined): boolean => t !== undefined && elemOf(t)?.family === "string"
    const hasText = (t: Type | undefined): boolean => isInt(t, true) || (t !== undefined && ["BOOL", "TIME"].includes(elemOf(t)?.name ?? ""))
    const parses = (t: Type): boolean => isInt(t) || elemOf(t)?.family === "real"
    if ((isString(to) && elemOf(to)?.name === "STRING" && hasText(from)) || (isString(from) && elemOf(from ?? UNKNOWN)?.name === "STRING" && parses(to))) {
      const only = e.args[0]
      if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
        return this.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
      const arg = this.expr(only.value, from)
      if (arg === undefined) return undefined
      const type = withStringCapacity(to)
      return { kind: "convert", value: convert(arg, withStringCapacity(from!)), type, span: e.span }
    }
    if (!scalar(to) || (from !== undefined && !scalar(from)))
      return this.bail("conversion-type", "this STRING conversion is not measured yet", e.span)
    // A duration or date converts to and from INTEGERS, in its own unit — TIME_TO_DINT(T#1S500MS) is 1500,
    // DATE_TO_UDINT(D#1970-01-02) is 86400 seconds, TOD_TO_UDINT(TOD#00:00:01) is 1000 ms (test/exec `time_conversions`,
    // `date_representation`). ↔ REAL/BOOL, and between two temporal types, were not measured: refused, not guessed.
    const temporal = [to, from].filter((t) => t !== undefined && ["time", "date"].includes(elemOf(t)?.family ?? "")).length
    const nonIntegral = [to, from].some((t) => t !== undefined && ["real", "bool"].includes(elemOf(t)?.family ?? ""))
    if ((temporal > 0 && nonIntegral) || temporal === 2)
      return this.bail("conversion-type", "a TIME/DATE conversion to REAL, BOOL or another temporal type is not measured yet", e.span)
    const only = e.args[0]
    if (e.args.length !== 1 || only?.value === undefined || only.param !== undefined || only.output)
      return this.bail("call-arity", "a conversion takes exactly one positional argument", e.span)
    const arg = this.expr(only.value)
    if (arg === undefined) return undefined
    const source = from === undefined ? arg : convert(arg, from)
    return elemOf(source.type)?.name === elemOf(to)?.name ? source : { kind: "convert", value: source, type: to, span: e.span }
  }

  /** The one type a list of operands meets at — a binary operator's rule, over N operands: variables decide, a
   *  REAL constant still widens (as in `int7 / 2.0`), all-constant integers fold as LINT, and the result promotes. */
  private meet(operands: readonly IrExpr[], span: Span): Type | undefined {
    const variables = operands.filter((o) => o.kind !== "const")
    let type =
      variables.length > 0
        ? variables.map((o) => o.type).reduce(commonType)
        : operands.map((o) => (elemOf(o.type)?.family === "int" ? elementaryRef("LINT") : o.type)).reduce(commonType)
    for (const o of operands) if (o.kind === "const" && elemOf(o.type)?.family === "real") type = commonType(type, o.type)
    if (type === UNKNOWN) return this.bail("type-unknown", "the arguments have no common type", span)
    return promoteForRuntime(type)
  }

  // ─── statements ────────────────────────────────────────────────────────────

  block(list: StatementList): IrStmt[] {
    const out: IrStmt[] = []
    for (const s of list) {
      const lowered = this.stmt(s)
      if (Array.isArray(lowered)) out.push(...lowered)
      else if (lowered !== undefined) out.push(lowered)
    }
    return out
  }

  /**
   * An assignment CHAIN — `a := b := c`, `a S= b R= c`, `a := b S= c`. One rule fits every chain measured
   * (test/exec `set_reset_chained*`, `assign_chained_*`): the VALUE flows right to left, converted to each link's
   * type as it passes; a `:=` link stores it, and an `S=`/`R=` link latches its target on it and passes it on UNCHANGED.
   *   - `a S= b R= c` with b FALSE, c TRUE SETS `a` — it latches on `c`, not on the old or new `b`;
   *   - `plain := latch S= cond` with cond FALSE makes `plain` FALSE even though `latch` stays TRUE;
   *   - `sint := dint := int` does not compile, "Cannot convert type 'DINT' to type 'SINT'" — `sint` receives the value
   *     as converted THROUGH the DINT link, not the INT source.
   * The value is evaluated ONCE, into a temp, so a call in it cannot run twice.
   */
  private chain(s: Extract<Statement, { kind: "assign" }>): IrStmt[] | undefined {
    const targets = [s.target, ...(s.chained ?? [])]
    const ops = [s.op, ...(s.chainOps ?? [])] // ops[i] is the operator after targets[i]
    if (ops.includes("REF=")) return this.bail("assign-op", "REF= in an assignment chain", s.span)
    const value = this.expr(s.value)
    if (value === undefined) return undefined
    const held: Place = { slot: this.temp("chain_value", value.type), path: [], type: value.type, span: s.value.span }
    const out: IrStmt[] = [{ kind: "assign", target: held, value, span: s.value.span }]
    let flowing: IrExpr = { kind: "load", place: held, type: value.type, span: s.value.span }
    for (let i = targets.length - 1; i >= 0; i--) {
      const target = this.place(targets[i]!)
      if (target === undefined) return undefined
      const op = ops[i]
      if (op === undefined) {
        flowing = convert(flowing, target.type) // a `:=` link converts the value on its way through
        out.push({ kind: "assign", target, value: flowing, span: s.span })
        continue
      }
      // a latch acts on the value and passes it on unchanged
      const latch: IrExpr = { kind: "const", value: op === "S=", type: elementaryRef("BOOL"), span: s.span }
      const set: IrStmt = { kind: "assign", target, value: convert(latch, target.type), span: s.span }
      out.push({ kind: "if", cond: convert(flowing, elementaryRef("BOOL")), then: [set], else: [], span: s.span })
    }
    return out
  }

  stmt(s: Statement): IrStmt | IrStmt[] | undefined {
    switch (s.kind) {
      case "empty":
        return undefined
      case "assign": {
        if (s.chained !== undefined) return this.chain(s)
        if (s.op === "REF=") return this.bail("assign-op", `${s.op} assignment`, s.span)
        const target = this.place(s.target)
        if (target === undefined) return undefined
        if (s.op === "S=" || s.op === "R=") {
          // A LATCH, not an assignment: `x S= c` sets x only when c is TRUE and otherwise leaves it — `latched := TRUE;
          // latched S= FALSE` stays TRUE — and `R=` clears the same way. The whole right-hand side is the condition:
          // `x S= (i > 5) AND flag` (test/exec `set_reset_*`). So it lowers to the IF it is; no backend sees an `S=`.
          const cond = this.expr(s.value, elementaryRef("BOOL"))
          if (cond === undefined) return undefined
          const latch: IrExpr = { kind: "const", value: s.op === "S=", type: elementaryRef("BOOL"), span: s.span }
          const set: IrStmt = { kind: "assign", target, value: convert(latch, target.type), span: s.span }
          return { kind: "if", cond, then: [set], else: [], span: s.span }
        }
        const value = this.expr(s.value, target.type)
        if (value === undefined) return undefined
        return { kind: "assign", target, value: convert(value, target.type), span: s.span }
      }
      case "if": {
        // ELSIF is an ELSE holding one nested IF — one shape for the backend, not a branch list.
        const build = (i: number): IrStmt | undefined => {
          const branch = s.branches[i]
          if (branch === undefined) return undefined
          const cond = this.expr(branch.cond, elementaryRef("BOOL"))
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
        const cond = this.expr(s.cond, elementaryRef("BOOL"))
        return cond && { kind: "loop", init: [], test: { cond, atEnd: false }, body: this.block(s.body), step: [], span: s.span }
      }
      case "repeat": {
        // REPEAT runs until its condition holds; the IR's test is "keep going", so it is negated here.
        const until = this.expr(s.until, elementaryRef("BOOL"))
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
          type: elementaryRef("BOOL"),
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

/** A slot's string type with its capacity stated: a sizeless STRING or WSTRING holds `DEFAULT_STRING_LENGTH`. */
function withStringCapacity(t: Type): Type {
  if (t.kind !== "elementary" || t.length !== undefined || (t.name !== "STRING" && t.name !== "WSTRING")) return t
  return { ...t, length: DEFAULT_STRING_LENGTH }
}

/** Wrap in an explicit conversion when the types differ — a backend never widens on its own. Two STRINGs of different
 *  capacity differ too: the conversion is where a longer string is truncated into a shorter one. */
function convert(e: IrExpr, to: Type): IrExpr {
  const from = elemOf(e.type)
  const target = elemOf(to)
  const sameCapacity =
    e.type.kind !== "elementary" || to.kind !== "elementary" || e.type.length === to.length
  if (from === undefined || target === undefined || (from.name === target.name && sameCapacity)) return e
  // Retyping a constant is free and leaves cleaner output than converting it at run time.
  if (e.kind === "const") return retype(e, to)
  return { kind: "convert", value: e, type: to, span: e.span }
}

/** Re-stamp a constant with a type, moving its value across the int/real divide if that is what changed. */
function retype(e: IrExpr, to: Type): IrExpr {
  if (e.kind !== "const" || elemOf(to) === undefined) return e
  return { ...e, value: valueAs(e.value, to), type: to }
}

/**
 * A constant taking its variable neighbour's type — but never a REAL constant demoted to an integer. `int7 / 2.0`
 * is 3.5 in CODESYS (test/exec `division_with_a_real_operand`); retyping the `2.0` to INT made it the integer 2
 * and the division integral. A REAL constant keeps its type, and `wider` meets the pair in REAL.
 */
function adopt(c: IrExpr, to: Type): IrExpr {
  return elemOf(c.type)?.family === "real" && elemOf(to)?.family !== "real" ? c : retype(c, to)
}

/** A constant value moved across the int/real divide to match `to`. Width is a backend's job (it stores it). */
function valueAs(v: IrValue, to: Type): IrValue {
  const target = elemOf(to)
  if (target === undefined) return v
  if (target.family === "real" && typeof v === "bigint") return Number(v)
  if (target.family !== "real" && typeof v === "number" && Number.isInteger(v)) return BigInt(v)
  return v
}

/**
 * A duration literal's value in its type's UNIT. Measured (test/exec `time_*`, `ltime_basic`): TIME is 32-bit
 * MILLISECONDS — T#49D17H2M47S295MS plus 1 ms wraps to 0 — and LTIME 64-bit NANOSECONDS. The AST normalizes both to
 * nanoseconds under one `literalKind: "time"`, so the prefix decides which. This used to type every duration TIME
 * and hold it in nanoseconds: a recalled design note, while `types/elementary` already said TIME is 32 bits.
 */
function durationOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const v = e.value
  if (e.literalKind !== "time" || typeof v !== "object" || v === null || !("ns" in v)) return undefined
  return inTicks(v.ns, literalType(e))
}

/**
 * A date, date-and-time or time-of-day literal's value in its type's UNIT. Measured (test/exec `date_*`,
 * `ldate_ltod_ldt`): DATE and DT count SECONDS since 1970-01-01 in 32 bits (DATE_TO_UDINT(D#1970-01-02) is 86400, not
 * 1; DT#2106-02-07-06:28:15 plus a second wraps to the epoch), TOD counts MILLISECONDS since midnight in 32 bits, and
 * LDATE / LDT / LTOD count NANOSECONDS in 64. The AST keeps the text (`"1970-01-02"`) and the prefix decides the type.
 */
function calendarOf(e: Extract<Expr, { kind: "literal" }>): { value: bigint; type: Type } | undefined {
  const text = e.value
  if (typeof text !== "string" || !["date", "datetime", "tod"].includes(e.literalKind)) return undefined
  const ns = calendarNanoseconds(e.literalKind as "date" | "datetime" | "tod", text)
  return ns === undefined ? undefined : inTicks(ns, literalType(e))
}

/**
 * A REAL- or LREAL-prefixed literal's value in its prefix type. The prefix decides, not the context: `lr := REAL#0.1`
 * stores float32's 0.1 (0.10000000149011612), where `LREAL#0.1` and an untyped `0.1` store float64's (test/exec
 * `typed_literal_real_prefix`). Lowering used to type every real literal by its context. An INTEGER prefix changed
 * nothing measured — `INT#30000 + INT#30000` still folds at full width (`typed_literal_constant_fold`) — so it keeps the
 * untyped path.
 */
function typedRealOf(e: Extract<Expr, { kind: "literal" }>): { value: number; type: Type } | undefined {
  if (e.literalKind !== "typed" || typeof e.value !== "number") return undefined
  const type = elementaryRef(e.prefix ?? "")
  const real = elemOf(type)
  if (real?.family !== "real") return undefined
  return { value: real.bits === 32 ? Math.fround(e.value) : e.value, type }
}

/** A nanosecond count in its type's ticks (`types/elementary` `tickNs`), with that type — the literal's own
 *  (`types/literalType`: its prefix decides). */
function inTicks(ns: bigint, type: Type): { value: bigint; type: Type } | undefined {
  const tick = elemOf(type)?.tickNs
  return tick === undefined ? undefined : { value: ns / tick, type }
}

/**
 * Date/time arithmetic, scaled between the units each type counts. Measured (test/exec `date_*`, `dt_*`, `tod_*`):
 *   - a date ± a duration, or a duration + a date, converts the duration into the DATE'S unit by truncating division —
 *     `DT#1970-01-01-00:00:00 + T#1500MS` is one second — and computes in the date's width: `DT max + T#1S` wraps to the
 *     epoch, `D#2024-02-28 + T#1D` is D#2024-02-29, `DT - T#1S` steps back across a leap day;
 *   - a date - a date of the same type is the difference scaled into TIME (LTIME for the L variants):
 *     `D#2024-03-01 - D#2024-02-28` is T#2D, and the reverse wraps as a UDINT (4122167296 ms);
 *   - TOD is NOT reduced modulo a day: TOD#12:30:15.5 + T#12H stores 88215500 ms (the IDE only DISPLAYS 0:30:15.500).
 * A duration finer than its date (a TIME on an LDT) was not measured: undefined, so lowering reports it.
 */
function calendarArithmetic(op: IrBinOp, left: IrExpr, right: IrExpr, span: Span): IrExpr | undefined {
  if (op !== "add" && op !== "sub") return undefined
  const [l, r] = [elemOf(left.type), elemOf(right.type)]
  const result = l && r && temporalResultType(op === "add" ? "+" : "-", l.name, r.name)
  if (result === undefined) return undefined
  const unit = (x: IrExpr): bigint | undefined => elemOf(x.type)?.tickNs
  const scale = (x: IrExpr, by: bigint, as: Type, how: "div" | "mul"): IrExpr =>
    by === 1n ? x : { kind: "binary", op: how, left: x, right: { kind: "const", value: by, type: as, span }, type: as, span }

  const type = elementaryRef(result)
  // a date ± a duration: the result is the date's type, and the date is whichever operand has it
  if (l?.name !== r?.name) {
    const [date, duration] = l?.name === result ? [left, right] : [right, left]
    const [dateUnit, durationUnit] = [unit(date), unit(duration)]
    if (dateUnit === undefined || durationUnit === undefined || dateUnit % durationUnit !== 0n) return undefined
    const step = scale(convert(duration, date.type), dateUnit / durationUnit, date.type, "div")
    return { kind: "binary", op, left: date, right: step, type: date.type, span }
  }
  // a date − the same date: the difference, scaled into its duration's unit
  const [leftUnit, durationUnit] = [unit(left), elemOf(type)?.tickNs]
  if (leftUnit === undefined || durationUnit === undefined) return undefined
  const difference: IrExpr = { kind: "binary", op: "sub", left, right, type: left.type, span }
  return scale(convert(difference, type), leftUnit / durationUnit, type, "mul")
}

/** Nanoseconds since the epoch (DATE/DT) or since midnight (TOD) for a literal's text, or undefined when malformed. */
function calendarNanoseconds(kind: "date" | "datetime" | "tod", text: string): bigint | undefined {
  const clock = (h: string, m: string, s: string, frac = ""): bigint =>
    ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(s)) * 1_000_000_000n + BigInt(frac.padEnd(9, "0").slice(0, 9) || "0")
  if (kind === "tod") {
    const t = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(text)
    return t === null ? undefined : clock(t[1]!, t[2]!, t[3]!, t[4])
  }
  const d = /^(\d+)-(\d+)-(\d+)(?:-(\d+):(\d+):(\d+)(?:\.(\d+))?)?$/.exec(text)
  if (d === null) return undefined
  const days = BigInt(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])) / 86_400_000)
  const midnight = days * 86_400n * 1_000_000_000n
  return kind === "date" || d[4] === undefined ? midnight : midnight + clock(d[4], d[5]!, d[6]!, d[7])
}

/** An untyped literal's type: the context's, or the narrowest that holds the value (its OWN type is `types/literalType`). */
function contextLiteralType(e: Extract<Expr, { kind: "literal" }>, expected?: Type): Type {
  const want = elemOf(expected ?? UNKNOWN)
  const v = e.value
  if (v === undefined) return UNKNOWN
  if (typeof v === "boolean") return elementaryRef("BOOL")
  // (strings and durations never reach here: `expr` lowers both before asking for a literal's type)
  if (typeof v === "string" || typeof v === "object") return UNKNOWN
  if (typeof v === "number") return want?.family === "real" ? expected! : elementaryRef(REAL_LITERAL_TYPE)
  // An integer literal: honour a numeric context (REAL included — `x : REAL := 1;` is legal), else narrowest.
  if (want !== undefined && want.rank !== undefined) return expected!
  // the narrowest type CODESYS gives the literal — `types/`'s, not a second list here (this one used to skip the unsigned)
  const t = integerLiteralType(v)
  return t === undefined ? UNKNOWN : elementaryRef(t.name)
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

/** A referenced library's materialized declaration file — `uri` must keep its `Library Manager/<library>/` path. */
export interface LibraryFile {
  uri: string
  source: string
}

/** Parse, bind and lower one source string, against the library files a project would reference. The test/CLI path. */
export function lowerSource(source: string, name?: string, libraries: readonly LibraryFile[] = []): LoweredPou {
  const parseResult = parseSource(source)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [{ code: "parse", message: first.message, span: first.span }] }
  }
  const project = buildSymbolTable([
    { uri: "transpile://source", parseResult, source },
    ...libraries.map((l) => ({ uri: l.uri, parseResult: parseSource(l.source), source: l.source })),
  ])
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
