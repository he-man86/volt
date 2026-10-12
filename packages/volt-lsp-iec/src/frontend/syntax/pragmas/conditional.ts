/**
 * CONDITIONAL PRAGMAS — what a pragma token SAYS (`directiveOf`); the `{IF}` condition grammar is `condition-parse.ts`,
 * its evaluation against a `ConditionWorld` `condition-eval.ts` (`evaluateCondition`). The statement parser
 * (`parse/body-pragmas.ts`) applies them: a directive stands only where a statement may start, and a branch not taken is
 * parsed in silence and dropped — one statement tree per body (`parse/body-parse.ts` `bodyStatements`).
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
import { parseCondition, type ConditionParse } from "./condition-parse.js"

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
