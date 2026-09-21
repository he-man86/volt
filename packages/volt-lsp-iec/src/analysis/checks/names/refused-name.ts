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
 * BOTH VENDORS, measured 2026-09-20: TwinCAT refuses the same names with the same ten-message cascade in
 * the same order, capitalising the one word its error list capitalises. This was CODESYS-only on a note
 * written when its recording covered 280 fixtures.
 */
import { isTrivia, lex, stmtExprs, walkExpr, walkStatements, type Span } from "../../../syntax/index.js"
import { bodies, forEachDecl } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import type { Vendor } from "../../config.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { CODESYS_ONLY_TYPES, elementaryType } from "../../../types/index.js"

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
  const report = (text: string, span: Span, inDeclaration = false): void => {
    push(ctx.messages.unexpectedToken(text), span)
    cascadeAfter(ctx, out, span.end, inDeclaration)
  }
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    for (const name of decl.names) if (isRefused(name.text, ctx.config.vendor)) report(name.text, name.span, true)
  }

  // AN UNKNOWN LITERAL PREFIX IS FOUND BY SCANNING THE SOURCE, not by walking the AST, because there is no AST
  // to walk: `v := LDT#2026-05-09-07:05:03;` leaves the statement list EMPTY — the parser gives up at the stray
  // `2026` and the body yields nothing at all. The prefix is unambiguous in raw tokens (an identifier ending in
  // `#`, a shape no valid source produces), which is the same reason `cascadeAfter` re-lexes rather than walking.
  // …once each. A cascade runs to the next `;`, so a second prefix in the SAME statement has already been
  // reported by the first one's resync — reporting it again adds a message for a position the parser never
  // reaches, out of order (`v := LDT#1 + LTOD#2;`).
  let reportedTo = -1
  for (const token of ctx.tokens()) {
    if (token.kind !== "identifier" || !isUnknownPrefix(token.text) || token.span.start < reportedTo) continue
    push(ctx.messages.expressionExpectedInsteadOf(token.text), token.span)
    cascadeAfter(ctx, out, token.span.start)
    reportedTo = cascadeEnd(ctx.source, token.span.start)
  }

  // Bare identifiers only: `S=`/`R=` are operator tokens, and a member name (`fb.S`) was not measured.
  for (const { statements } of bodies(ctx.parseResult.units, ctx.project))
    walkStatements(statements, (s) => {
      const args = callArgumentNames(s)
      for (const e of stmtExprs(s))
        walkExpr(e, (x) => {
          if (x.kind !== "ident_expr") return
          const operatorCall = ST_OPERATOR_CALLS.has(x.name.toLowerCase())
          if (!operatorCall && (!isRefusedInBody(x.name, ctx.config.vendor) || args.has(x.span.start))) return
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
function isRefused(text: string, vendor: Vendor): boolean {
  return isRefusedInBody(text, vendor) || text.includes("__")
}

/**
 * Those of them a USE is refused for too — a compiler operator (`__NEW`) is spelled with underscores and is legal.
 *
 * THE TYPE NAMES ARE ONLY RESERVED WHERE THE TYPE EXISTS. `ldate : INT;` is a legal TwinCAT declaration, because
 * TwinCAT has no `LDATE` (`types/elementary.ts`), and reading the shared elementary table here reported it as a
 * refused name and then cascaded ten messages over a file that compiles. `resolveNamedType` got this gate when the
 * types became dialect data; this call site was missed, and nothing caught it because the check had been
 * CODESYS-only until the same day.
 */
function isRefusedInBody(text: string, vendor: Vendor): boolean {
  const reservedType = elementaryType(text) !== undefined && !(vendor === "twincat" && CODESYS_ONLY_TYPES.has(text.toUpperCase()))
  return IL_OPERATOR_NAMES.has(text.toLowerCase()) || reservedType || isUnknownPrefix(text)
}

/**
 * A `<prefix>#` identifier — which only the TwinCAT dialect's lexer produces, for a literal prefix that vendor does
 * not have (`LDATE#`, `LDT#`, `LTOD#`, `UCHAR#`; see `CODESYS_ONLY_LITERAL_PREFIXES`). TwinCAT quotes the prefix
 * WHOLE and then resyncs exactly like any other refused name — `v := LDT#2026-05-09-07:05:03;` is "Expression
 * expected instead of 'LDT#'" and then a pair per token to the `;` (`xf_ldt_to_*`, `cc_ld*_literal_into_*`). On
 * CODESYS these lex as one `date_lit` token and never reach this, which is why the test is the `#` and not a list.
 */
function isUnknownPrefix(text: string): boolean {
  return text.endsWith("#")
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

/** Where a cascade from `at` stops — the `;` it resyncs to, or the end of the source. */
function cascadeEnd(source: string, at: number): number {
  const semi = source.indexOf(";", at)
  return semi < 0 ? source.length : semi
}

/** The line ending the FILE uses. */
const eol = (source: string): string => (source.includes("\r\n") ? "\r\n" : "\n")

/**
 * The IDE's parse-error CASCADE after a bad identifier. CODESYS reports the name, then resyncs by demanding a `;`:
 * for every token up to the next one it emits `';' expected instead of 'T'` and `Unexpected token 'T' found`, in that
 * order (conformance `cc_reserved_name_r`, `cc4_type_name_bit_as_variable` — `bit : BOOL;` is five errors, not one).
 * Only the first was emitted here, so 22 fixtures whose every IDE error is part of such a cascade could never agree.
 */
function cascadeAfter(ctx: CheckContext, out: DiagnosticItem[], from: number, inDeclaration = false): void {
  // WITH THE PROJECT'S DIALECT. Re-lexing as CODESYS reads `LDATE#2026-05-09` as ONE date literal, so the cascade
  // quoted a token TwinCAT never saw — the vocabulary has to be the same on the second pass as on the first.
  for (const token of lex(ctx.source.slice(from), ctx.config.vendor)) {
    if (isTrivia(token.kind)) continue
    if (token.text === ";") return
    const span = { ...token.span, start: token.span.start + from, end: token.span.end + from }
    // A token that could START a statement gets the `';' expected` line and NOTHING else; anything else is also
    // echoed back as "Unexpected token". Measured across every recorded cascade: the variables `a`, `b` and `c` are
    // alone (`operator_call_form_*`, `ampersand_operator_rejected`) while `INT` and `BOOL` are paired
    // (`echo_lower_case_function_name`, `echo_mixed_case_il_operator`). An ELEMENTARY TYPE NAME is a keyword to
    // CODESYS even though this lexer reads it as an identifier, which is what `isRefusedInBody` already knows.
    const ordinaryName = token.kind === "identifier" && !isRefusedInBody(token.text, ctx.config.vendor)
    const messages: { severity: "error" | "warning"; message: string }[] = [
      { severity: "error", message: ctx.messages.semicolonExpectedInsteadOf(token.text) },
    ]
    if (!ordinaryName) messages.push({ severity: "error", message: ctx.messages.unexpectedToken(token.text) })
    // …and an ordinary name IS a statement once the compiler has supplied the `;` it was asking for, so it also
    // says what it always says about a statement that reads a variable and does nothing with it. The code it
    // quotes is the one it reconstructed — the name, the semicolon it inserted, and a line break — measured
    // identically on both vendors (`operator_call_form_arithmetic`, `_comparison`: twelve of these each).
    // The break is the FILE's own: the vendors write CRLF and quote CRLF, and an editor should quote what is
    // actually there. (The conformance comparison normalizes it, so this choice is about the editor.)
    //
    // IN A DECLARATION IT IS NOT A STATEMENT AT ALL, so it does not get this. Every recorded declaration cascade
    // ends in a keyword or an elementary type name and so never reached the branch — but `s : ST_Foo;` (a project
    // type after an IL-operator name) does, and the declaration part is where the compilers say "This code is not
    // supported in Declaration part" instead. Unmeasured is not a licence to invent the body's answer.
    else if (!inDeclaration)
      messages.push({ severity: "warning", message: ctx.messages.codeHasNoEffect(`${token.text};${eol(ctx.source)}`) })
    for (const m of messages)
      out.push({ severity: m.severity, span, source: SOURCE, code: "refused-name", message: m.message })
  }
}
