/**
 * THE `{IF}` CONDITION GRAMMAR — a condition's text read into a `Condition` tree, the vendor's errors for one it does not
 * read, or a refusal naming what Volt does not read (never a guess). One method per precedence level: `NOT` binds before
 * `AND`, `AND` before `OR`. Split from `conditional.ts` (openspec lsp-same-standard design.md §2.2), whose header states
 * what was measured.
 */

/** One `{IF}` condition. */
export type Condition =
  | { op: "not"; operand: Condition }
  | { op: "and" | "or"; left: Condition; right: Condition }
  | { op: "defined"; name: string }
  | { op: "defined_in"; kind: "variable" | "type" | "pou" | "task" | "resource"; name: string }
  | { op: "hasvalue"; name: string; value: string }
  | { op: "hasattribute"; kind: "pou" | "variable"; name: string; attribute: string }
  | { op: "hastype"; name: string; type: string }
  | { op: "hasconstanttype"; name: string; replaced: boolean }
  | { op: "hasconstantvalue"; name: string; value: bigint; compare: "<" | "<=" | "=" | "<>" | ">=" | ">" }
  | { op: "project_defined"; name: string }

/** The vendor's errors for a condition it does not read — each a message, and the `(` token's fact for its wording. */
export interface ConditionError {
  message: string
  /** "Unexpected token '(' found": the token, so the analysis layer can word it per vendor (`ParseError.unexpectedToken`). */
  unexpectedToken?: string
  /** "Single byte string expected for an attribute value instead of 'X'": the text found (`ParseError.attributeValueString`). */
  attributeValueString?: string
}

/** A condition read: the tree, the vendor's errors, or a refusal naming what Volt does not read (never a guess). */
export type ConditionParse = { ok: Condition; text: string } | { errors: readonly ConditionError[] } | { refused: string }

/** A condition (or a question it asks) Volt does not read: answered by a refusal naming it. */
export class Refused extends Error {}

/** A condition the vendor answers with errors of its own. */
export class VendorError extends Error {
  constructor(readonly errors: readonly ConditionError[]) {
    super("vendor error")
  }
}

/** The vendor's answer to a word that is no operator, before its `(`: measured on both vendors for `volt_unknown (X)` and
 *  `DEFINED (X)` (`prag_if_unknown_operator`, `prag_if_mixed_case_condition`). */
export const UNKNOWN_OPERATOR_ERRORS: readonly ConditionError[] = [
  { message: "Unexpected token '(' found", unexpectedToken: "(" },
  { message: "'!!!'ERROR'!!!' is no valid condition for pragma" },
]

type Tok = { kind: "word" | "string" | "number" | "punct"; text: string }

function tokenize(text: string): Tok[] | undefined {
  const out: Tok[] = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const ws = /^\s+/.exec(rest)
    if (ws !== null) {
      i += ws[0].length
      continue
    }
    const m =
      /^([A-Za-z_]\w*)/.exec(rest) ??
      /^('[^']*')/.exec(rest) ??
      /^([+-]?\d+)/.exec(rest) ??
      /^(<=|>=|<>|[(),:<>=])/.exec(rest)
    if (m === null) return undefined
    const t = m[1]!
    out.push({ kind: /^[A-Za-z_]/.test(t) ? "word" : t.startsWith("'") ? "string" : /^[+-]?\d/.test(t) ? "number" : "punct", text: t })
    i += t.length
  }
  return out
}

const OPERATORS = new Set(["defined", "hasvalue", "hasattribute", "hastype", "hasconstanttype", "hasconstantvalue", "project_defined"])
const DEFINED_KINDS = new Set(["variable", "type", "pou", "task", "resource"])
const COMPARES = new Set(["<", "<=", "=", "<>", ">=", ">"])

export function parseCondition(text: string): ConditionParse {
  const toks = tokenize(text)
  if (toks === undefined || toks.length === 0) return { refused: `the condition {${text}} is not one Volt reads` }
  const r = new ConditionReader(toks)
  try {
    const c = r.or()
    if (!r.atEnd()) throw new Refused()
    return { ok: c, text }
  } catch (e) {
    if (e instanceof VendorError) return { errors: e.errors }
    if (e instanceof Refused) return { refused: `the condition {${text}} is not one Volt reads` }
    throw e
  }
}

/** The recursive descent over one condition's tokens — throws `Refused` or `VendorError` where it stops. */
class ConditionReader {
  private i = 0

  constructor(private readonly toks: readonly Tok[]) {}

  atEnd(): boolean {
    return this.i === this.toks.length
  }

  private peek(): Tok | undefined {
    return this.toks[this.i]
  }

  private take(): Tok | undefined {
    return this.toks[this.i++]
  }

  private expect(t: string): void {
    if (this.peek()?.text !== t) throw new Refused()
    this.i++
  }

  private word(): string {
    const t = this.take()
    if (t?.kind !== "word") throw new Refused()
    return t.text
  }

  private string(): string {
    const t = this.take()
    if (t?.kind !== "string") throw new Refused()
    return t.text.slice(1, -1)
  }

  or(): Condition {
    let left = this.and()
    while (this.peek()?.text === "OR") {
      this.i++
      left = { op: "or", left, right: this.and() }
    }
    return left
  }

  private and(): Condition {
    let left = this.not()
    while (this.peek()?.text === "AND") {
      this.i++
      left = { op: "and", left, right: this.not() }
    }
    return left
  }

  private not(): Condition {
    if (this.peek()?.text === "NOT") {
      this.i++
      return { op: "not", operand: this.not() }
    }
    return this.primary()
  }

  private primary(): Condition {
    if (this.peek()?.text === "(") {
      this.i++
      const inner = this.or()
      this.expect(")")
      return inner
    }
    const op = this.word()
    if (!OPERATORS.has(op)) {
      if (this.peek()?.text === "(") throw new VendorError(UNKNOWN_OPERATOR_ERRORS)
      throw new Refused()
    }
    this.expect("(")
    const c = this.operands(op)
    this.expect(")")
    return c
  }

  /** The operator `op`'s operands, between its parentheses. */
  private operands(op: string): Condition {
    switch (op) {
      case "defined": {
        const first = this.word()
        if (this.peek()?.text !== ":") return { op: "defined", name: first }
        if (!DEFINED_KINDS.has(first)) throw new Refused()
        this.i++
        return { op: "defined_in", kind: first as "variable", name: this.word() }
      }
      case "hasvalue": {
        const name = this.word()
        this.expect(",")
        return { op: "hasvalue", name, value: this.string() }
      }
      case "hasattribute":
        return this.hasattribute()
      case "hastype": {
        if (this.word() !== "variable") throw new Refused()
        this.expect(":")
        const name = this.word()
        this.expect(",")
        return { op: "hastype", name, type: this.word() }
      }
      case "hasconstanttype": {
        const name = this.word()
        this.expect(",")
        const v = this.word()
        if (v !== "TRUE" && v !== "FALSE") throw new Refused()
        return { op: "hasconstanttype", name, replaced: v === "TRUE" }
      }
      case "hasconstantvalue":
        return this.hasconstantvalue()
      default:
        return { op: "project_defined", name: this.word() }
    }
  }

  private hasattribute(): Condition {
    const kind = this.word()
    if (kind !== "pou" && kind !== "variable") throw new Refused()
    this.expect(":")
    const name = this.word()
    this.expect(",")
    // the attribute is a quoted string; a bare word is the vendor's error (`cc6_attribute_value_unquoted`, both vendors)
    const found = this.peek()
    if (found?.kind === "word")
      throw new VendorError([{ message: `Single byte string expected for an attribute value instead of '${found.text}'`, attributeValueString: found.text }])
    return { op: "hasattribute", kind, name, attribute: this.string() }
  }

  private hasconstantvalue(): Condition {
    const name = this.word()
    this.expect(",")
    const v = this.take()
    if (v?.kind !== "number") throw new Refused()
    this.expect(",")
    const compare = this.take()?.text
    if (compare === undefined || !COMPARES.has(compare)) throw new Refused()
    return { op: "hasconstantvalue", name, value: BigInt(v.text), compare: compare as "=" }
  }
}
