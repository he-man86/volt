/**
 * parse-errors (syntax/) — surfaces every syntax error the parser recorded, wherever it recorded it.
 *
 * The syntax layer parses in two passes, each of which *collects* (never throws) its errors on a Cursor:
 *   - the TOP-LEVEL parse — unit headers, VAR sections, TYPE bodies → `parseResult.errors`
 *   - each ST STATEMENT body (`isStBody`), parsed on demand → `bodyStatements(body).errors`
 * Both streams are the same `ParseError` (a message + a precise span), so this check drains both into one
 * `code:"syntax-error"` diagnostic stream — a missing `THEN`, a missing `;`, a `VAR_INPUT` inside a STRUCT
 * and an unterminated section are all "the parser found bad syntax here", reported at the offending token.
 *
 * (Bodies are captured as opaque tokens at the unit level — the IDE stays authoritative for statement
 * *semantics* — but their *syntax* structure is the parser's to decide, so surfacing it is not a semantics
 * check.)
 *
 * Zero-FP contract: the corpus + conformance replay compile clean, so ANY error here on known-good code is a
 * GRAMMAR GAP to fix, never a shipped false positive — the same gate every semantic check answers to.
 * `scripts/parser-completeness.ts` is the standing proof: both streams record zero errors on the whole corpus.
 */
import { exprText, initOperatorText, isStBody, bodyStatements, compilerTypeText, unitBodies, type ParseError, type VarDecl, type VarSectionKind } from "../../../frontend/syntax/index.js"
import { bodyConditionWorld } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import type { Vendor } from "../../config.js"

/**
 * Whether `vendor`'s compiler reports this parse error at all. The parser has no vendor, so a shape the two compilers
 * answer differently arrives as a FACT: a global missing its `;` (`globalMissingSemicolon`) is reported by TwinCAT and
 * passed over in silence by CODESYS (`pwh_gvl_missing_semicolon`, 2026-09-30). Every path that hands a parse error to a
 * client asks this — the semantic pass here and the server's own parse-error stream.
 */
export function vendorReportsParseError(e: ParseError, vendor: Vendor): boolean {
  return !(e.globalMissingSemicolon === true && vendor === "codesys")
}

/**
 * A parse error's text as `messages`' vendor words it. The parser has no vendor, so the shapes the two compilers
 * capitalise differently arrive as FACTS rather than as final text — "Unexpected token" (CODESYS) / "Unexpected Token"
 * (TwinCAT, `echo_*`, measured on both recordings 2026-09-20), and an operator's operand count ("operands" / "Operands").
 * Every path that shows a parse error words it here.
 */
export function parseErrorMessage(e: ParseError, messages: CheckContext["messages"]): string {
  if (e.unexpectedToken !== undefined) return messages.unexpectedToken(e.unexpectedToken)
  if (e.orphanPragma !== undefined) return messages.orphanPragma(e.orphanPragma)
  if (e.unterminatedConditional === true) return messages.unterminatedConditional()
  if (e.noCaseLabel === true) return messages.noCaseLabel()
  if (e.attributeValueString !== undefined) return messages.attributeValueString(e.attributeValueString)
  if (e.directAddressExpected !== undefined) return messages.directAddressExpectedAt(e.directAddressExpected)
  if (e.sectionInStruct !== undefined) return sectionInStructMessage(e.sectionInStruct, messages)
  if (e.sectionEcho !== undefined) return sectionEchoMessage(e.sectionEcho.keyword, e.sectionEcho.decls)
  if (e.operandCount !== undefined) {
    const { operator, count, atLeast } = e.operandCount
    return atLeast ? messages.operatorNeedsAtLeast(operator, count) : messages.operatorNeedsExactly(operator, count)
  }
  return e.message
}

/**
 * A VAR section inside a STRUCT, named as each vendor names its placement (`decl_<kw>_inside_struct`, both vendors
 * 2026-10-01): the three parameter sections by their CamelCase kind, on both vendors alike; VAR_GLOBAL and VAR_CONFIG by
 * where they belong; the rest as a section not allowed here. VAR and VAR_EXTERNAL draw no such message (the parser
 * reports none).
 */
const PARAMETER_SECTION_NAMES: Partial<Record<VarSectionKind, string>> = { VAR_INPUT: "VarInput", VAR_OUTPUT: "VarOutput", VAR_IN_OUT: "VarInOut" }
function sectionInStructMessage(kind: VarSectionKind, messages: CheckContext["messages"]): string {
  const parameter = PARAMETER_SECTION_NAMES[kind]
  if (parameter !== undefined) return `'${parameter}' not allowed in this place`
  if (kind === "VAR_CONFIG") return messages.varConfigOnlyInList()
  return messages.sectionNotAllowed(kind)
}

/**
 * A VAR section inside a STRUCT as the compiler reads it back: each declaration on its own tab-indented line, the names
 * joined by ", ", `:` tight against the type, ` := ` around the value — "Variable declaration expected instead of
 * VAR\r\n\ta:INT := 5;\r\nEND_VAR\r\n" (`decl_var_inside_struct`, `_init`, `_names`, CODESYS 2026-10-01; the value
 * measured on one literal).
 */
function sectionEchoMessage(keyword: string, decls: readonly VarDecl[]): string {
  const lines = decls.map((d) => {
    const init = d.init === undefined ? "" : ` ${initOperatorText(d.initOp)}${d.init.kind === "aggregate_init" ? d.init.tokens.map((t) => t.text).join("") : exprText(d.init)}`
    return `\t${d.names.map((n) => n.text).join(", ")}:${compilerTypeText(d.type)}${init};\r\n`
  })
  return `Variable declaration expected instead of ${keyword}\r\n${lines.join("")}END_VAR\r\n`
}

/** A parse error's diagnostic code: the conditional-pragma structure keeps the codes its catalog entries name (C0081 for
 *  an orphan directive), every other shape is a syntax error. */
function parseErrorCode(e: ParseError): string {
  if (e.orphanPragma !== undefined) return "orphan-conditional-pragma"
  if (e.unterminatedConditional === true) return "unterminated-conditional-pragma"
  if (e.attributeValueString !== undefined) return "attribute-value-string"
  return "syntax-error"
}

export function checkParseErrors(ctx: CheckContext, out: DiagnosticItem[]): void {
  const emit = (e: ParseError): void => {
    if (!vendorReportsParseError(e, ctx.config.vendor)) return
    out.push({ severity: "error", span: e.span, source: SOURCE, code: parseErrorCode(e), message: parseErrorMessage(e, ctx.messages) })
  }
  // Declaration structure — recorded on the top-level parse cursor (unit headers, VAR sections, type decls).
  for (const e of ctx.parseResult.errors) emit(e)
  // Statement bodies — re-parsed here (opaque tokens at the unit level), each on its own cursor.
  for (const unit of ctx.parseResult.units) {
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      for (const e of bodyStatements(body, bodyConditionWorld(ctx.project, unit, body)).errors) emit(e)
    }
  }
}
