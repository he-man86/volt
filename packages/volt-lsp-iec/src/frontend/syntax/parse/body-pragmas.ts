/**
 * PRAGMAS INSIDE A BODY — where a statement may start, the conditional directives (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`,
 * `{define}`/`{undefine}`) and the message pragmas act (`applyPragmas`); everywhere else in a body a pragma is trivia.
 * The state of one parse (`PragmaState`) is kept per cursor (`PRAGMAS`). Split from `statements.ts` (openspec
 * lsp-same-standard design.md §2.2), whose header states the rule.
 */
import type { ParseError } from "../ast/nodes/index.js"
import type { Token } from "../lex/tokens.js"
import { directiveOf, type MessageSeverity } from "../pragmas/conditional.js"
import type { ConditionError, ConditionParse } from "../pragmas/condition-parse.js"
import { evaluateCondition, type ConditionWorld } from "../pragmas/condition-eval.js"
import type { Span } from "../span.js"
import type { Cursor } from "./cursor.js"

/** A message pragma (`{warning 'x'}` …) where a statement may start, in a branch taken — what the build says. */
export interface PragmaMessage {
  severity: MessageSeverity
  text: string
  span: Span
}

/** The vendor's words for a chain left open where its statement list ends (`cc_unterminated_if`, both vendors). */
export const UNTERMINATED_CONDITIONAL = "Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected"

/** Whether a region of the body is compiled: surely, surely not, or as a condition Volt could not decide goes. */
type Compiled = "on" | "maybe" | "off"

/** A region is compiled as its least-compiled enclosing part is. */
export const compiledOf = (parts: readonly Compiled[]): Compiled => (parts.includes("off") ? "off" : parts.includes("maybe") ? "maybe" : "on")

/** The conditional state of one parse: the world its conditions ask, the body's own defines, what it says. */
export interface PragmaState {
  world: ConditionWorld
  defines: Map<string, string | undefined>
  /** Defines a `{define}`/`{undefine}` in an undecided branch may have changed: a question about one is undecided too. */
  uncertain: Set<string>
  messages: PragmaMessage[]
  /** Pragma tokens already applied — a trivia run is acted on once. */
  applied: Set<Token>
  /** The branches being parsed in silence, outermost first — not compiled, or undecided. */
  silent: Compiled[]
  /** The first question the world could not answer. */
  refused?: string
  /** The SOURCE reading: no condition is asked, every branch is undecided — parsed in silence and KEPT in the tree. */
  source?: true
  /** The errors of a condition's TEXT, said wherever its directive stands — in a branch not taken, or parsed in silence
   *  inside a statement of one — and so kept apart from the cursor's, which silence drops (`prag_hasattribute_unquoted_*`). */
  textErrors: ParseError[]
}

/** One open `{IF}` chain of a statement list. */
export interface Chain {
  /** Whether the branch being read is compiled. */
  compiled: Compiled
  /** Whether a branch of the chain was taken (in a region not compiled, it counts as taken). */
  taken: "yes" | "no" | "maybe"
  sawElse: boolean
}

export const PRAGMAS = new WeakMap<Cursor, PragmaState>()

/**
 * Act on the pragmas in the trivia before the next statement of a list whose open chains are `chains`: the conditional
 * directives and the message pragmas. Errors are the vendor's: an `{ELSE}`/`{ELSIF}` after the chain's `{ELSE}`, or one
 * with no chain open in this list, is "Unexpected pragma: 'X' found without matching 'if'" (`prag_else_twice`,
 * `prag_elsif_after_else`, `prag_unbalanced_end_if`); a condition the vendor does not read is its two errors.
 *
 * A condition the world cannot answer leaves its chain UNDECIDED (`maybe`): each branch is parsed in silence, a define
 * there makes its name uncertain, nothing in it is said — and the chain's structure, which no decision changes, is still
 * tracked, so what follows it is read as the vendor reads it either way.
 */
export function applyPragmas(cur: Cursor, st: PragmaState, chains: Chain[]): void {
  for (const p of cur.pragmasAhead()) {
    if (st.applied.has(p)) continue
    st.applied.add(p)
    const d = directiveOf(p.text)
    if (d === undefined) continue
    // an unquoted `hasattribute` attribute is an error of the condition's TEXT: both vendors say it on an {IF}/{ELSIF}
    // whether or not its condition is asked — after a taken branch, in an untaken branch (`prag_hasattribute_unquoted_*`)
    if ((d.kind === "if" || d.kind === "elsif") && !st.source && "errors" in d.condition)
      for (const e of d.condition.errors) if (e.attributeValueString !== undefined) st.textErrors.push({ message: e.message, span: p.span, attributeValueString: e.attributeValueString })
    const top = chains.at(-1)
    // is the region around the innermost open chain compiled — and the region here, inside it?
    const outer = compiledOf([...st.silent, ...chains.slice(0, -1).map((c) => c.compiled)])
    const here = compiledOf([outer, top?.compiled ?? "on"])
    const orphan = (word: string): void => {
      if (outer === "on") cur.pushParseError({ message: `Unexpected pragma: '${word}' found without matching 'if'`, span: p.span, orphanPragma: word })
    }
    const decide = (condition: ConditionParse): boolean | "maybe" => {
      if (st.source) return "maybe"
      if ("refused" in condition) return undecided(st, condition.refused)
      if ("errors" in condition) return vendorErrors(cur, condition.errors, p.span)
      const v = evaluateCondition(condition.ok, st.world, st.defines, st.uncertain)
      if (typeof v === "boolean") return v
      if ("refused" in v) return undecided(st, v.refused)
      return vendorErrors(cur, v.errors, p.span)
    }
    const branch = (v: boolean | "maybe"): Pick<Chain, "compiled" | "taken"> =>
      v === "maybe" ? { compiled: "maybe", taken: "maybe" } : v ? { compiled: "on", taken: "yes" } : { compiled: "off", taken: "no" }
    switch (d.kind) {
      case "if":
        // in a region not surely compiled, a nested chain is as compiled as its region, whatever its condition
        chains.push(here === "on" ? { ...branch(decide(d.condition)), sawElse: false } : { compiled: here, taken: "yes", sawElse: false })
        break
      case "elsif":
        if (top === undefined || top.sawElse) orphan("ELSIF")
        else if (outer !== "on") top.compiled = outer
        else if (top.taken === "yes") top.compiled = "off"
        // an earlier branch may have been taken: this one is undecided, and its condition is not asked
        else if (top.taken === "maybe") top.compiled = "maybe"
        else Object.assign(top, branch(decide(d.condition)))
        break
      case "else":
        if (top === undefined || top.sawElse) orphan("ELSE")
        else {
          top.compiled = outer !== "on" ? outer : top.taken === "yes" ? "off" : top.taken === "no" ? "on" : "maybe"
          top.taken = "yes"
          top.sawElse = true
        }
        break
      case "end_if":
        if (top === undefined) orphan("END_IF")
        else chains.pop()
        break
      case "define":
      case "undefine":
        if (here === "maybe") st.uncertain.add(d.name)
        if (here !== "on") break
        st.uncertain.delete(d.name)
        if (d.kind === "define") st.defines.set(d.name, d.value)
        else st.defines.delete(d.name)
        break
      case "message":
        if (here === "on") st.messages.push({ severity: d.severity, text: d.text, span: p.span })
        break
    }
  }
}

/** A condition the world cannot answer: the first is the body's `refused`, and its chain is undecided. */
function undecided(st: PragmaState, reason: string): "maybe" {
  st.refused ??= reason
  return "maybe"
}

/** Record a condition's vendor errors at its pragma (an error of its text is `PragmaState.textErrors`', said already);
 *  the branch is not taken. */
function vendorErrors(cur: Cursor, errors: readonly ConditionError[], span: Span): false {
  for (const e of errors) if (e.attributeValueString === undefined) cur.pushParseError({ message: e.message, span, ...(e.unexpectedToken === undefined ? {} : { unexpectedToken: e.unexpectedToken }) })
  return false
}
