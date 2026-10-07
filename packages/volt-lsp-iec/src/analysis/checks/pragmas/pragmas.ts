/**
 * pragma diagnostics (D.2 · pragmas/). Several rules over the pragma tokens (the rest — wrong-vendor /
 * conflict / companion / init-slot — need the Layer-F pragma catalog and are FP-prone, so deferred):
 *   - C0051 hasattribute: a `{IF hasattribute(pou: X, <attr>)}` whose attribute operand is unquoted.
 *   - MESSAGE pragmas: `{warning 'msg'}` / `{error 'msg'}` surface the author's compile-time message
 *     verbatim at matching severity — in a body only where a statement may start and in a branch taken
 *     (`bodyStatements(…).messages`, frontend-conformance 2.7.3: inside an expression, between a statement's keywords
 *     or in an untaken branch neither vendor says it), and as written outside the bodies.
 *   - C0351 unknown `{attribute '<name>'}` (CODESYS-only) — a toggleable warning, only as complete as the catalog.
 *   - a KNOWN attribute given a value outside its published set. CODESYS-only, and only for attributes whose
 *     legal values are published and CLOSED.
 *
 * The CONDITIONAL structure (an orphan `{ELSE}`/`{ELSIF}`/`{END_IF}`, an `{IF}` never closed) is the statement parser's
 * (`parse/statements` `applyPragmas`), reported with the body's other syntax errors by `parse-errors`.
 */
import { isKnownAttribute } from "../../../reference/index.js"
import { allUnits, bodyStatements, directiveOf, isStBody, readAttribute, unitBodies } from "../../../frontend/syntax/index.js"
import { bodyConditionWorld } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkPragmas(ctx: CheckContext, out: DiagnosticItem[]): void {
  const message = (directive: string, text: string, span: DiagnosticItem["span"]): void => {
    const severity = directive === "error" ? "error" : directive === "warning" ? "warning" : undefined
    if (severity !== undefined) out.push({ severity, span, source: SOURCE, code: `message-pragma-${directive}`, message: text })
  }
  const pragmas = ctx.tokens()
    .filter((t) => t.kind === "pragma")
    .map((t) => ({ span: t.span, text: t.text, ...parsePragma(t.text) }))

  // `{attribute 'abstract'}` ON A METHOD OR A FUNCTION_BLOCK, WITHOUT THE KEYWORD — "The ABSTRACT keyword is missing"
  // (a warning). The attribute is the OLD spelling; SP21 wants `METHOD ABSTRACT Shape : INT` / `FUNCTION_BLOCK ABSTRACT`
  // and says so when it finds one without the other — on each (`cc6_abstract_attribute_on_fb`,
  // `cc6_abstract_attribute_on_method`; `cc4_not_instantiable` carries it on both and records two). This said "a METHOD
  // rule, the FB records NOTHING": the recorder dropped every pragma above a top-level unit (frontend-conformance 2.7.2),
  // so the FB's attribute never reached the IDE. Re-recorded 2026-10-02 with it there.
  // CODESYS ONLY, measured: TwinCAT builds all three CLEAN (2026-10-02). It warns about a spelling Beckhoff never
  // deprecated, so it is one rule of several in this check rather than a check to scope to CODESYS in the registry (`pipeline/registry`).
  // On a PROPERTY and a FUNCTION as well (`prag_rule_abstract_attribute_on_property`, `_on_function`, analysis-conformance
  // 3.10, CODESYS; TwinCAT clean): a FUNCTION takes no ABSTRACT keyword at all, and CODESYS still says it is missing.
  // On a PROGRAM and on an INTERFACE's METHOD too (`prag_rule_abstract_attribute_on_program`, `_on_interface_method`, the
  // 3.10 gate review, CODESYS; TwinCAT clean): the warning does not depend on the POU kind. An interface member carries no
  // attributes of its own — the pragma attaches to the interface — so it is found by position: the member it stands above.
  if (ctx.config.vendor === "codesys")
    for (const unit of ctx.parseResult.units) {
      const isAbstract = (a: { name: string }) => a.name.toLowerCase() === "abstract"
      if (unit.kind === "interface") {
        const members = [...unit.methods, ...unit.properties]
        for (const a of (unit.attributes ?? []).filter(isAbstract)) {
          if (a.span.start < unit.span.start) continue // above the INTERFACE itself: unmeasured
          const member = members.filter((m) => m.span.start >= a.span.end).sort((x, y) => x.span.start - y.span.start)[0]
          if (member === undefined || member.modifiers.includes("ABSTRACT")) continue
          out.push({ severity: "warning", span: member.name.span, source: SOURCE, code: "abstract-keyword-missing", message: ctx.messages.abstractKeywordMissing() })
        }
        continue
      }
      if (unit.kind !== "method" && unit.kind !== "function_block" && unit.kind !== "property" && unit.kind !== "function" && unit.kind !== "program") continue
      if (!(unit.attributes ?? []).some(isAbstract)) continue
      if ((unit.kind === "method" || unit.kind === "function_block" || unit.kind === "property") && unit.modifiers.includes("ABSTRACT")) continue
      out.push({ severity: "warning", span: unit.name.span, source: SOURCE, code: "abstract-keyword-missing", message: ctx.messages.abstractKeywordMissing() })
    }

  // `{attribute 'pingroup'}` ON A UNIT — "The attribute 'pingroup' can only be added to variable declarations. It will
  // be ignored here." CODESYS ONLY (`pragma_conflicting_pair`, re-recorded 2026-10-02 with the pragma pushed; TwinCAT
  // builds it clean). Only `pingroup` is measured; no other attribute's placement rule is guessed from it.
  if (ctx.config.vendor === "codesys")
    for (const unit of ctx.parseResult.units)
      for (const a of "attributes" in unit ? (unit.attributes ?? []) : [])
        if (a.name.toLowerCase() === "pingroup")
          out.push({ severity: "warning", span: a.span, source: SOURCE, code: "unknown-attribute", message: ctx.messages.attributeOnlyOnVariables(a.name) })

  // The ST bodies: a pragma in one is the statement parser's to read (`parse/statements` `applyPragmas`), and what it says
  // there it reports itself — the rules below read only the pragmas OUT of a body as text.
  const said: { severity: string; text: string; span: DiagnosticItem["span"] }[] = []
  const bodySpans: { start: number; end: number }[] = []
  for (const unit of allUnits(ctx.parseResult.units))
    for (const body of unitBodies(unit)) {
      if (!isStBody(body)) continue
      bodySpans.push(body.span)
      said.push(...bodyStatements(body, bodyConditionWorld(ctx.project, unit, body)).messages)
    }
  const outOfBody = (p: { span: DiagnosticItem["span"] }): boolean => !bodySpans.some((b) => b.start <= p.span.start && p.span.end <= b.end)

  // C0051 — a `hasattribute(pou: X, <attr>)` conditional-compile operand whose attribute is unquoted. The
  // attribute must be a single-byte string literal ('MyAttribute'); a bare identifier is an error. Verified live
  // CODESYS 3.5.21. In a body the statement parser reports it on every `{IF}`/`{ELSIF}` where a statement may start, its
  // condition asked or not (`prag_hasattribute_unquoted_*`, both vendors; `pragmas/conditional`,
  // `ParseError.attributeValueString`, `parse-errors`); out of one, this narrow scan.
  for (const p of pragmas) {
    if (!outOfBody(p)) continue
    const m = /hasattribute\s*\(([^)]*)\)/i.exec(p.text)
    if (m === null) continue
    const attr = m[1]!.split(",").pop()!.trim()
    if (attr.length === 0 || attr.startsWith("'")) continue // quoted (or empty) — valid
    out.push({ severity: "error", span: p.span, source: SOURCE, code: "attribute-value-string", message: ctx.messages.attributeValueString(attr) })
  }

  // Message pragmas — only error/warning have IDE ground truth (info/text are hint-level, no oracle). A body's are the
  // ones its parse says (`bodyStatements(…).messages`); in a chain whose condition the LSP cannot decide it says none,
  // outside one it says what it says whichever way the chain goes. In source order, as the token scan said them.
  for (const p of pragmas) if (p.messageText !== undefined && outOfBody(p)) said.push({ severity: p.directive, text: p.messageText, span: p.span })
  for (const m of said.sort((a, b) => a.span.start - b.span.start)) message(m.severity, m.text, m.span)

  // Unknown `{attribute '<name>'}` — C0351, a toggleable warning (only as complete as the catalog). CODESYS-only:
  // live /build confirmed TwinCAT compiles an unknown attribute clean (no diagnostic), so firing it there would FP.
  // ALSO skipped on a file that is a global variable list: CODESYS does not run the attribute-check pass on one —
  // `{attribute 'Tc2GvlVarNames'}` above a `VAR_GLOBAL` is the one of the seventeen `tc_*` fixtures CODESYS says
  // NOTHING about, and it is not about the name (re-recorded 2026-10-02 with the pragma pushed: still silent).
  // A DUT was skipped too, "verified live" on pro2193's enum: wrong — every DUT kind warns
  // (`prag_unknown_attribute_on_{struct,enum,alias,union}`, `tc_global_data_type`, `tc_hide_sub_items`, 2026-10-02;
  // the recorder had been dropping every pragma above a top-level unit, frontend-conformance 2.7.2).
  // …above the LIST, that is: an unknown attribute on one of a GVL's VARIABLES warns (`prag_rule_unknown_attribute_on_gvl_variable`,
  // analysis-conformance 3.10), so what is skipped is a list's pragma outside its sections.
  const isGvl = ctx.parseResult.units.length > 0 && ctx.parseResult.units.every((u) => u.kind === "global_var_list")
  const inGvlSection = (p: { span: DiagnosticItem["span"] }): boolean =>
    ctx.parseResult.units.some((u) => u.kind === "global_var_list" && u.varSections.some((v) => v.span.start <= p.span.start && p.span.end <= v.span.end))
  /**
   * `{attribute 'hide'}` on the SAME declaration silences the value check: a hidden variable is not monitored, so
   * the compiler never validates how it would be displayed. Measured — `monitoring_encoding` warns about 'UTF8' and
   * `pragma_conflict_hide_plus_monitoring`, the same attribute with `hide` above it, says nothing at all.
   * Pragmas decorating one declaration are consecutive with only whitespace between them.
   */
  const isHidden = (p: { span: DiagnosticItem["span"] }): boolean =>
    pragmas.some(
      (q) =>
        q.attributeName?.toLowerCase() === "hide" &&
        ctx.source.slice(Math.min(q.span.end, p.span.end), Math.max(q.span.start, p.span.start)).trim().length === 0,
    )
  if (ctx.config.vendor === "codesys") {
    for (const p of pragmas) {
      if (isGvl && !inGvlSection(p)) continue
      // an attribute written as a STATEMENT in a body attaches to nothing and CODESYS says nothing of it
      // (`prag_rule_unknown_attribute_in_body`, analysis-conformance 3.10)
      if (!outOfBody(p)) continue
      // C0351a — a KNOWN attribute (`symbol`) with an out-of-set VALUE. `symbol` governs symbol-table export;
      // a typo (`'noe'`) is a real C0351 (pro2193's C0564 beside it are the initialization order of its PROGRAMs, not a
      // cascade of this — `initord_chain4_symbol_noe`, analysis-conformance 3.12). Same C0351 code + toggle as the unknown-NAME case, distinct wording. Only `symbol` has a
      // published closed value set, so it's the only one checked (zero-FP: every other attribute is skipped).
      if (p.attributeName?.toLowerCase() === "symbol" && p.attributeValue !== undefined && !SYMBOL_VALUES.has(p.attributeValue)) {
        out.push({
          severity: "warning",
          span: p.span,
          source: SOURCE,
          code: "unknown-attribute",
          message: ctx.messages.invalidSymbolAttributeValue(p.attributeValue),
        })
        continue
      }
      // The same rule for every OTHER attribute with a published closed value set, in that message's own wording
      // (conformance `monitoring_encoding`).
      const closed = p.attributeName === undefined ? undefined : CLOSED_VALUE_SETS[p.attributeName.toLowerCase()]
      if (closed !== undefined && p.attributeValue !== undefined && !closed.some((c) => c.toLowerCase() === p.attributeValue!.toLowerCase()) && !isHidden(p)) {
        out.push({
          severity: "warning",
          span: p.span,
          source: SOURCE,
          code: "unknown-attribute",
          message: ctx.messages.invalidAttributeValue(p.attributeValue, p.attributeName!, closed),
        })
        continue
      }
      // C0351 — an unknown attribute NAME (only as complete as the catalog).
      if (p.attributeName === undefined || isKnownAttribute(p.attributeName, ctx.config.vendor)) continue
      out.push({
        severity: "warning",
        span: p.span,
        source: SOURCE,
        code: "unknown-attribute",
        message: ctx.messages.unknownAttribute(p.attributeName),
      })
    }
  }
}

/** The legal access modes for `{attribute 'symbol'}` (symbol-table export). CODESYS: none/read/write/readwrite, in lower
 *  case only — `'READ'` warns (`prag_rule_symbol_value_upper_case`, analysis-conformance 3.10). */
const SYMBOL_VALUES: ReadonlySet<string> = new Set(["none", "read", "write", "readwrite"])

/**
 * Attributes whose legal values are a published closed set, in the compiler's own order (it prints the set), compared
 * WITHOUT case — `monitoring_encoding := 'utf-8'` builds clean (`prag_rule_monitoring_encoding_lower_case`, analysis-conformance
 * 3.10; `symbol`'s set is the case-sensitive one). Only
 * an attribute whose set is CLOSED and documented belongs here — every other attribute is skipped, so an unusual
 * but legal value never false-positives. `symbol` is handled above: its message has a different shape.
 */
const CLOSED_VALUE_SETS: Record<string, readonly string[]> = {
  monitoring_encoding: ["UTF-8", "UnicodeCharacter"],
}


/** Extract a pragma's directive (first word), a message pragma's quoted body, and an attribute's name+value. */
function parsePragma(text: string): { directive: string; messageText?: string; attributeName?: string; attributeValue?: string } {
  // a message pragma as the statement parser reads one (`syntax/pragmas/conditional` `directiveOf`): its word in lower
  // case only — `{WARNING 'x'}` builds clean on both vendors (`prag_warning_upper_case_in_declaration`)
  const said = directiveOf(text)
  if (said?.kind === "message") return { directive: said.severity, messageText: said.text }
  const m = /^\{\s*([^\s}]+)/.exec(text)
  const directive = m?.[1] ?? ""
  if (directive === "attribute") {
    // the front-end's one reading of an attribute (`syntax/pragmas/attributes` `parseAttribute`): an UNQUOTED value
    // (`:= readwrite`) is the empty string to the compiler — "Invalid value ''" (`cc4_attribute_value_string`)
    const a = readAttribute(text)
    if (a !== undefined) return { directive, attributeName: a.name, attributeValue: a.value }
  }
  return { directive }
}
