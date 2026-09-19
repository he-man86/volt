/**
 * refused-name (names/). A name CODESYS's PARSER refuses, which fails on the name itself — `ld : INT;` reports
 * `Unexpected token 'ld' found`, echoing it as written, then cascades to the next `;`. Three families, each measured:
 *
 *   - the INSTRUCTION-LIST operators (`r`, `s`, `ld`, `st`, `ret`, `cal` …), reported at the declaration AND at every
 *     use (conformance `cc_reserved_name_r`, `cc_reserved_name_s_upper`, `cc_il_name_*`);
 *   - the ELEMENTARY TYPE names (`bit`, `byte` …), reported the same way — but NOT as a call argument, because
 *     `XSIZEOF(DINT)` is a legitimate type argument (`cc4_type_name_bit_as_variable`, `cc4_type_name_byte_as_variable`);
 *   - an identifier holding CONSECUTIVE UNDERSCORES (`foo__bar`, `__systemReserved`), which the compiler reserves for
 *     itself (`identifier_consecutive_underscores`, `identifier_double_underscore`). Declarations only: `__NEW`,
 *     `__QUERYINTERFACE` and the rest are compiler operators whose USES are legitimate.
 *
 * Why nothing caught the first family: the lexer reads these as identifiers (`R`/`S` only become `R=`/`S=` before an
 * `=`), so the parser accepted the declaration; the reserved-name handling covers the keyword table (`LIMIT`, `MIN` …,
 * which CODESYS echoes UPPER-case — a different mechanism); no fixture declared one; and no real project does. `CAL`
 * sat in the keyword table, so `cal` was reported as 'CAL' with a false "Identifier 'cal' not defined" on its use.
 *
 * Not here: `CALC` — CODESYS parses `calc : INT;` as a conditional call and says other things ("Second parameter of
 * conditional call must be a valid call statement" …), unmodelled. The comparison and arithmetic IL operators (`LT`,
 * `ADD` …) are ST keywords, so a DECLARATION of one is the parser's business — but their CALL FORM is refused here
 * (`ST_OPERATOR_CALLS`).
 *
 * CODESYS-only: TwinCAT is unmeasured, and a guess there would be a new false positive.
 */
import { isTrivia, lex, stmtExprs, walkExpr, walkStatements, type Span } from "../../../syntax/index.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { elementaryType } from "../../../types/index.js"

const IL_OPERATOR_NAMES: ReadonlySet<string> = new Set([
  "r", "s", "ld", "ldn", "st", "stn", "ret", "retc", "retcn", "jmpc", "jmpcn", "cal", "calcn", "andn", "orn", "xorn",
])

/**
 * The IL operators that have an ST KEYWORD of the same name — `added := ADD(a, b)` is Instruction List, and CODESYS
 * refuses it where it would accept `a + b`. All ten measured on SP21 (`operator_call_form_arithmetic`,
 * `_comparison`, `_extensible`), each the same triple the other refused names get.
 *
 * They need their own set because they are refused AS A CALLEE, which `callArgumentNames` exempts for the type names
 * beside them (`LTIME()` reads the clock). DECLARATIONS are not here: `ADD` is in the keyword table, so
 * `add : INT;` is the parser's broken-declaration cascade, not this.
 */
const ST_OPERATOR_CALLS: ReadonlySet<string> = new Set([
  "add", "sub", "mul", "div", "gt", "lt", "le", "ge", "eq", "ne",
])

export function checkRefusedName(ctx: CheckContext, out: DiagnosticItem[]): void {
  const push = (message: string, span: Span): void => {
    out.push({ severity: "error", span, source: SOURCE, code: "refused-name", message })
  }
  /** At a DECLARATION, and where a statement STARTS: the name, then the resync to the next `;`. */
  const report = (text: string, span: Span): void => {
    push(ctx.messages.unexpectedToken(text), span)
    cascadeAfter(ctx, out, span.end)
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project))
    for (const name of decl.names) if (isRefused(name.text)) report(name.text, name.span)

  // Bare identifiers only: `S=`/`R=` are operator tokens, and a member name (`fb.S`) was not measured.
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      const args = callArgumentNames(s)
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "ident_expr") return
          const operatorCall = ST_OPERATOR_CALLS.has(x.name.toLowerCase())
          if (!operatorCall && (!isRefusedInBody(x.name) || args.has(x.span.start))) return
          // Where the statement STARTS the parser is still looking for a target, so it reports the name and resyncs;
          // anywhere else it was looking for an OPERAND, and says so first (`n := byte;` — three errors on `byte`).
          if (x.span.start === s.span.start) report(x.name, x.span)
          else {
            push(ctx.messages.expressionExpectedInsteadOf(x.name), x.span)
            cascadeAfter(ctx, out, x.span.start)
          }
        })
    })
}

/** The name families the parser refuses at a DECLARATION. */
function isRefused(text: string): boolean {
  return isRefusedInBody(text) || text.includes("__")
}

/** Those of them a USE is refused for too — a compiler operator (`__NEW`) is spelled with underscores and is legal. */
function isRefusedInBody(text: string): boolean {
  return IL_OPERATOR_NAMES.has(text.toLowerCase()) || elementaryType(text) !== undefined
}

/**
 * The spans a type name may legitimately occupy in a statement: a call's ARGUMENT, because `XSIZEOF(DINT)` names a
 * type, and a call's CALLEE, because several elementary type names are also functions — `LTIME()` reads the clock
 * (corpus pro2193 `StopwatchFB`, which is how this exclusion was found).
 */
function callArgumentNames(s: Parameters<typeof stmtExprs>[0]): ReadonlySet<number> {
  const spans = new Set<number>()
  for (const e of stmtExprs(s))
    walkExpr(e, (x) => {
      if (x.kind !== "call") return
      if (x.callee.kind === "ident_expr") spans.add(x.callee.span.start)
      for (const a of x.args) if (a.value?.kind === "ident_expr") spans.add(a.value.span.start)
    })
  return spans
}

/**
 * The IDE's parse-error CASCADE after a bad identifier. CODESYS reports the name, then resyncs by demanding a `;`:
 * for every token up to the next one it emits `';' expected instead of 'T'` and `Unexpected token 'T' found`, in that
 * order (conformance `cc_reserved_name_r`, `cc4_type_name_bit_as_variable` — `bit : BOOL;` is five errors, not one).
 * Only the first was emitted here, so 22 fixtures whose every IDE error is part of such a cascade could never agree.
 */
function cascadeAfter(ctx: CheckContext, out: DiagnosticItem[], from: number): void {
  for (const token of lex(ctx.source.slice(from))) {
    if (isTrivia(token.kind)) continue
    if (token.text === ";") return
    const span = { ...token.span, start: token.span.start + from, end: token.span.end + from }
    // A token that could START a statement gets the `';' expected` line and NOTHING else; anything else is also
    // echoed back as "Unexpected token". Measured across every recorded cascade: the variables `a`, `b` and `c` are
    // alone (`operator_call_form_*`, `ampersand_operator_rejected`) while `INT` and `BOOL` are paired
    // (`echo_lower_case_function_name`, `echo_mixed_case_il_operator`). An ELEMENTARY TYPE NAME is a keyword to
    // CODESYS even though this lexer reads it as an identifier, which is what `isRefusedInBody` already knows.
    const ordinaryName = token.kind === "identifier" && !isRefusedInBody(token.text)
    const messages = [ctx.messages.semicolonExpectedInsteadOf(token.text)]
    if (!ordinaryName) messages.push(ctx.messages.unexpectedToken(token.text))
    for (const message of messages)
      out.push({ severity: "error", span, source: SOURCE, code: "refused-name", message })
  }
}
