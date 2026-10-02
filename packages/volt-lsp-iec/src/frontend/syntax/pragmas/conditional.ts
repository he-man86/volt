/**
 * CONDITIONAL PRAGMAS — what a pragma token SAYS (`directiveOf`), the `{IF}` condition grammar, and its evaluation
 * against a `ConditionWorld` (`evaluateCondition`). The statement parser (`parse/statements.ts`) applies them: a
 * directive stands only where a statement may start, and a branch not taken is parsed in silence and dropped — one
 * statement tree per body (`parse/body-parse.ts` `bodyStatements`).
 *
 * Measured (frontend-conformance 2.7.1, `fixtures/grammar/pragmas.ts`, CODESYS and TwinCAT 2026-10-02):
 *   - the words are CASE-SENSITIVE: `IF`/`ELSIF`/`ELSE`/`END_IF` upper, `define`/`undefine`, every operator and the
 *     message words (`text`/`info`/`warning`/`error`) lower;
 *     `{if …}`, `{DEFINE X}` are no directive (trivia), `DEFINED (X)` is an unknown operator;
 *   - a define's name is case-sensitive, and a define is the body's own (one in the declaration part or in the FB's
 *     body is not seen by the body / the METHOD);
 *   - `NOT` binds before `AND`, `AND` before `OR`;
 *   - `hasvalue (X, 'v')` of a define without a value is FALSE; `hasconstantvalue (c, v, op)` is `c op v`;
 *   - `defined (resource: …)` is FALSE (documented as not implemented);
 *   - `project_defined` and `hasconstanttype` are CODESYS's: TwinCAT answers each as an unknown operator.
 */
import { TYPED_PREFIXES, type Dialect } from "../lex/vocabulary.js"

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

export type MessageSeverity = "text" | "info" | "warning" | "error"

/** What a pragma token says, when it is a directive the statement parser acts on. */
export type Directive =
  | { kind: "if" | "elsif"; condition: ConditionParse }
  | { kind: "else" }
  | { kind: "end_if" }
  | { kind: "define"; name: string; value?: string }
  | { kind: "undefine"; name: string }
  | { kind: "message"; severity: MessageSeverity; text: string }

const CONDITIONAL = /^\{\s*(IF|ELSIF|ELSE|END_IF|define|undefine)\b\s*([\s\S]*?)\s*\}$/
/** A message pragma: its word in LOWER case only — `{WARNING 'x'}`, `{Warning 'x'}` and `{ERROR 'x'}` build clean on both
 *  vendors, in a body and above a declaration (`prag_warning_upper_case`, `prag_warning_mixed_case`,
 *  `prag_error_upper_case`, `prag_warning_upper_case_in_declaration`, 2026-10-02), as every pragma word is case-sensitive.
 *  `directiveOf` is the one reading: the analysis asks it for the pragmas out of a body too (`analysis/checks/pragmas`). */
const MESSAGE_PRAGMA = /^\{\s*(text|info|warning|error)\s+'([^']*)'/

/** What `text` (a whole pragma token, braces included) says — undefined for any pragma that is no directive. */
export function directiveOf(text: string): Directive | undefined {
  const m = CONDITIONAL.exec(text)
  if (m !== null) {
    const word = m[1]!
    const rest = m[2]!
    switch (word) {
      case "IF":
        return { kind: "if", condition: parseCondition(rest) }
      case "ELSIF":
        return { kind: "elsif", condition: parseCondition(rest) }
      case "ELSE":
        return { kind: "else" }
      case "END_IF":
        return { kind: "end_if" }
      case "define": {
        const d = /^([A-Za-z_]\w*)(?:\s+'([^']*)')?/.exec(rest)
        if (d === null) return undefined
        return d[2] === undefined ? { kind: "define", name: d[1]! } : { kind: "define", name: d[1]!, value: d[2] }
      }
      case "undefine": {
        const d = /^([A-Za-z_]\w*)/.exec(rest)
        return d === null ? undefined : { kind: "undefine", name: d[1]! }
      }
    }
  }
  const msg = MESSAGE_PRAGMA.exec(text)
  if (msg !== null) return { kind: "message", severity: msg[1] as MessageSeverity, text: msg[2]! }
  return undefined
}

/** Is `text` a conditional directive (`{IF}`…`{END_IF}`, `{define}`, `{undefine}`) — what makes a body's tree depend on a
 *  world? */
export function isConditionalDirective(text: string): boolean {
  return CONDITIONAL.test(text)
}

// ─── the condition grammar ────────────────────────────────────────────────────────────────────────────────────────

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

class Refused extends Error {}
class VendorError extends Error {
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

function parseCondition(text: string): ConditionParse {
  const toks = tokenize(text)
  if (toks === undefined || toks.length === 0) return { refused: `the condition {${text}} is not one Volt reads` }
  let i = 0
  const peek = () => toks[i]
  const take = () => toks[i++]
  const expect = (t: string): void => {
    if (peek()?.text !== t) throw new Refused()
    i++
  }
  const word = (): string => {
    const t = take()
    if (t?.kind !== "word") throw new Refused()
    return t.text
  }
  const string = (): string => {
    const t = take()
    if (t?.kind !== "string") throw new Refused()
    return t.text.slice(1, -1)
  }
  const or = (): Condition => {
    let left = and()
    while (peek()?.text === "OR") {
      i++
      left = { op: "or", left, right: and() }
    }
    return left
  }
  const and = (): Condition => {
    let left = not()
    while (peek()?.text === "AND") {
      i++
      left = { op: "and", left, right: not() }
    }
    return left
  }
  const not = (): Condition => {
    if (peek()?.text === "NOT") {
      i++
      return { op: "not", operand: not() }
    }
    return primary()
  }
  const primary = (): Condition => {
    if (peek()?.text === "(") {
      i++
      const inner = or()
      expect(")")
      return inner
    }
    const op = word()
    if (!OPERATORS.has(op)) {
      if (peek()?.text === "(") throw new VendorError(UNKNOWN_OPERATOR_ERRORS)
      throw new Refused()
    }
    expect("(")
    let c: Condition
    switch (op) {
      case "defined": {
        const first = word()
        if (peek()?.text === ":") {
          if (!DEFINED_KINDS.has(first)) throw new Refused()
          i++
          c = { op: "defined_in", kind: first as "variable", name: word() }
        } else c = { op: "defined", name: first }
        break
      }
      case "hasvalue": {
        const name = word()
        expect(",")
        c = { op: "hasvalue", name, value: string() }
        break
      }
      case "hasattribute": {
        const kind = word()
        if (kind !== "pou" && kind !== "variable") throw new Refused()
        expect(":")
        const name = word()
        expect(",")
        // the attribute is a quoted string; a bare word is the vendor's error (`cc6_attribute_value_unquoted`, both vendors)
        const found = peek()
        if (found?.kind === "word")
          throw new VendorError([{ message: `Single byte string expected for an attribute value instead of '${found.text}'`, attributeValueString: found.text }])
        c = { op: "hasattribute", kind, name, attribute: string() }
        break
      }
      case "hastype": {
        if (word() !== "variable") throw new Refused()
        expect(":")
        const name = word()
        expect(",")
        c = { op: "hastype", name, type: word() }
        break
      }
      case "hasconstanttype": {
        const name = word()
        expect(",")
        const v = word()
        if (v !== "TRUE" && v !== "FALSE") throw new Refused()
        c = { op: "hasconstanttype", name, replaced: v === "TRUE" }
        break
      }
      case "hasconstantvalue": {
        const name = word()
        expect(",")
        const v = take()
        if (v?.kind !== "number") throw new Refused()
        expect(",")
        const compare = take()?.text
        if (compare === undefined || !COMPARES.has(compare)) throw new Refused()
        c = { op: "hasconstantvalue", name, value: BigInt(v.text), compare: compare as "=" }
        break
      }
      default:
        c = { op: "project_defined", name: word() }
    }
    expect(")")
    return c
  }
  try {
    const c = or()
    if (i !== toks.length) throw new Refused()
    return { ok: c, text }
  } catch (e) {
    if (e instanceof VendorError) return { errors: e.errors }
    if (e instanceof Refused) return { refused: `the condition {${text}} is not one Volt reads` }
    throw e
  }
}

// ─── evaluation ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The project's and the unit's names, as the binder knows them. */
export interface ConditionNames {
  /** A variable named `name` is visible in the current scope. */
  variable(name: string): boolean
  type(name: string): boolean
  pou(name: string): boolean
  /** Does `name`'s declaration carry `{attribute '<attribute>'}` — undefined when `name` is not found. */
  hasAttribute(kind: "pou" | "variable", name: string, attribute: string): boolean | undefined
  /** The NAME of the type the variable `name` is declared with, upper-case and as written — an alias, a DUT or an FB by
   *  its own name — undefined when `name` is no variable declared with a plain type name. */
  typeOf(name: string): string | undefined
  /** The integer value of the constant `name` — undefined when it is no constant with a literal integer value. */
  constantValue(name: string): bigint | undefined
}

/** Facts of the device the code is compiled for. */
export interface DeviceFacts {
  littleEndian: boolean
  simulation: boolean
  fpu: boolean
  registerSize: number
  packMode: number
}

/** What the project's compile settings say, each part known or not: its compile defines (CODESYS's Application > Build >
 *  Compiler defines, the TwinCAT PLC project's "Compiler defines") and its task configuration. */
export interface ProjectFacts {
  defines?: ReadonlySet<string>
  tasks?: ReadonlySet<string>
}

/** The environment a project is compiled in, as far as a consumer MEASURED it: the device and the project's compile
 *  settings. The LSP knows neither; the conformance harness states the recording projects' (`defined (VOLT_NEVER_DEFINED)`
 *  measures their defines), the transpiler the exec oracle's (`transpile/lower/conditions.ts`). */
export interface CompileEnvironment {
  device?: DeviceFacts
  project?: ProjectFacts
}

/**
 * What a condition may ask beyond the body's own defines. Every part is optional and a question about an absent part is
 * REFUSED by name, never answered by a default: the LSP holds no device, no project compile defines and no task
 * configuration, so `defined (IsSimulationMode)` there is unknown — not FALSE — and so is `defined (X)` of any name the
 * body does not define itself (a compile define of the application makes it TRUE).
 */
export interface ConditionWorld extends CompileEnvironment {
  /** The vendor, for the operators only CODESYS reads (`project_defined`, `hasconstanttype`). */
  dialect?: Dialect
  names?: ConditionNames
}

/** The device's defines, as measured on the exec device (frontend-conformance 2.7.1): its FLAGS asked by `defined`, its
 *  VALUES by `hasvalue`. The crossed shapes (`defined (RegisterSize)`, `hasvalue (IsSimulationMode, …)`) are measured
 *  nowhere and refused by name (0 occurrences in the corpora). */
const DEVICE_DEFINES: Record<string, keyof DeviceFacts> = { IsLittleEndian: "littleEndian", IsSimulationMode: "simulation", IsFPUSupported: "fpu" }
const DEVICE_VALUES: Record<string, keyof DeviceFacts> = { RegisterSize: "registerSize", PackMode: "packMode" }
export type ConditionValue = boolean | { refused: string } | { errors: readonly ConditionError[] }

/**
 * `condition` under `world` and the body's own `defines` (name → value, case-sensitive). `uncertain` names the defines a
 * `{define}`/`{undefine}` may or may not have changed — one in a branch whose condition was refused — so a question
 * about one is refused too.
 */
export function evaluateCondition(
  condition: Condition,
  world: ConditionWorld,
  defines: ReadonlyMap<string, string | undefined>,
  uncertain: ReadonlySet<string> = new Set(),
): ConditionValue {
  const refuse = (what: string): never => {
    throw new Refused(what)
  }
  const names = (what: string): ConditionNames => world.names ?? refuse(`${what} asks the project's names, which this parse was not given`)
  const device = (what: string): DeviceFacts => world.device ?? refuse(`${what} asks a fact of the device, which Volt does not know here`)
  const projectDefines = (what: string): ReadonlySet<string> =>
    world.project?.defines ?? refuse(`${what} asks the project's compile defines, which Volt does not know here`)
  const tasks = (what: string): ReadonlySet<string> =>
    world.project?.tasks ?? refuse(`${what} asks the project's task configuration, which Volt does not know here`)
  const certain = (name: string, what: string): void => {
    if (uncertain.has(name)) refuse(`${what} asks a define made or removed in a branch Volt could not decide`)
  }
  const ev = (c: Condition): boolean => {
    switch (c.op) {
      case "not":
        return !ev(c.operand)
      case "and":
        return ev(c.left) && ev(c.right)
      case "or":
        return ev(c.left) || ev(c.right)
      case "defined": {
        const what = `defined (${c.name})`
        certain(c.name, what)
        if (defines.has(c.name)) return true
        const fact = Object.hasOwn(DEVICE_DEFINES, c.name) ? DEVICE_DEFINES[c.name] : undefined
        // a device VALUE define asked by `defined` is no measured shape: refused, never the project defines' FALSE
        if (Object.hasOwn(DEVICE_VALUES, c.name)) refuse(`${what} asks whether the device's value define is defined, which no recording measured`)
        // a name the body does not define is the project's compile define, or a device's
        return fact === undefined ? projectDefines(what).has(c.name) : (device(what)[fact] as boolean)
      }
      case "defined_in": {
        const what = `defined (${c.kind}: ${c.name})`
        if (c.kind === "resource") return false
        if (c.kind === "task") return tasks(what).has(c.name)
        return names(what)[c.kind](c.name)
      }
      case "hasvalue": {
        const what = `hasvalue (${c.name}, '${c.value}')`
        certain(c.name, what)
        if (defines.has(c.name)) return defines.get(c.name) === c.value
        const fact = Object.hasOwn(DEVICE_VALUES, c.name) ? DEVICE_VALUES[c.name] : undefined
        if (fact !== undefined) return String(device(what)[fact]) === c.value
        // a device FLAG define asked by `hasvalue` is no measured shape: refused, never the project defines' FALSE
        if (Object.hasOwn(DEVICE_DEFINES, c.name)) refuse(`${what} asks the value of the device's flag define, which no recording measured`)
        // a compile define of the project has a value Volt is not given: only its absence answers
        return projectDefines(what).has(c.name) ? refuse(`${what} asks the value of a project compile define, which Volt does not know here`) : false
      }
      case "hasattribute": {
        const what = `hasattribute (${c.kind}: ${c.name}, '${c.attribute}')`
        return names(what).hasAttribute(c.kind, c.name, c.attribute) ?? refuse(`${what}: '${c.name}' is not found`)
      }
      case "hastype": {
        // Measured for an elementary type spec against a variable of an elementary type (`prag_if_hastype`, INT and DINT):
        // a generic spec (ANY_INT, …, which CODESYS documents) and a variable of an alias, a DUT or an FB are not, and
        // are refused rather than compared by name.
        const what = `hastype (variable: ${c.name}, ${c.type})`
        if (!TYPED_PREFIXES.has(c.type.toUpperCase())) refuse(`${what}: the type spec '${c.type}' is not an elementary type Volt has measured hastype against`)
        const t = names(what).typeOf(c.name) ?? refuse(`${what}: '${c.name}' is no variable declared with a type name`)
        if (!TYPED_PREFIXES.has(t)) refuse(`${what}: '${c.name}' is declared with '${t}', which is not an elementary type Volt has measured hastype against`)
        return t === c.type.toUpperCase()
      }
      case "hasconstanttype":
        codesysOnly(`hasconstanttype (${c.name}, ${c.replaced ? "TRUE" : "FALSE"})`)
        return refuse(`hasconstanttype (${c.name}, ${c.replaced ? "TRUE" : "FALSE"}) asks the project's 'Replace constants' option, which Volt does not know here`)
      case "hasconstantvalue": {
        const what = `hasconstantvalue (${c.name}, ${c.value}, ${c.compare})`
        const v = names(what).constantValue(c.name) ?? refuse(`${what}: '${c.name}' is no constant with an integer value`)
        switch (c.compare) {
          case "<":
            return v < c.value
          case "<=":
            return v <= c.value
          case "=":
            return v === c.value
          case "<>":
            return v !== c.value
          case ">=":
            return v >= c.value
          case ">":
            return v > c.value
        }
        return false
      }
      case "project_defined":
        codesysOnly(`project_defined (${c.name})`)
        return projectDefines(`project_defined (${c.name})`).has(c.name)
    }
  }
  /** `what` is an operator CODESYS alone reads: TwinCAT's answer is the unknown-operator pair. */
  const codesysOnly = (what: string): void => {
    if (world.dialect === "twincat") throw new VendorError(UNKNOWN_OPERATOR_ERRORS)
    if (world.dialect === undefined) refuse(`${what} is read by CODESYS alone, and this parse was not given its vendor`)
  }
  try {
    return ev(condition)
  } catch (e) {
    if (e instanceof VendorError) return { errors: e.errors }
    if (e instanceof Refused) return { refused: e.message }
    throw e
  }
}
