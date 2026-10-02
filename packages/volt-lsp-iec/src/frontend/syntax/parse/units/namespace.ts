/**
 * `NAMESPACE Name <inner-units> END_NAMESPACE`
 *
 * Namespaces contain other top-level units recursively. Because the
 * dispatcher (`parseTopLevel`) lives in `parser.ts` and that function
 * needs to call back into us, we accept a `parseInner` callback as
 * dependency injection — keeps the import graph acyclic.
 *
 * A WORKSPACE FILE HOLDS NO NAMESPACE BLOCK (rule U28, fixtures `unit_namespace_*`, 2026-10-01). A project has no
 * namespace object — a namespace is a library's, named in its manifest — so the text is inside some other object. In a
 * POU, Volt's push refuses its END_NAMESPACE on both vendors ("expected METHOD/ACTION/PROPERTY, got: END_NAMESPACE"),
 * and `reportNamespaceClosers` reports each closer on its line, as the push refuses it — and only there: a GVL's and a
 * DUT's text is written as sent (one opening with NAMESPACE declares nothing, `source-object.ts`), and text that is no
 * workspace file is no push's. The keyword line ALONE does reach the IDE, and CODESYS reads such an object as
 * declaring nothing and says nothing about its text — so a NAMESPACE that runs to the end of the file is no error of
 * its own.
 *
 * Two shapes are not reported, each niche: accepted loss (0 occurrences in the corpora — their NAMESPACE lines are all
 * library manifests', and none of their 97 project interfaces has a line after END_INTERFACE):
 *   - in an interface the closer stands after END_INTERFACE, which the push refuses as any line there ("nothing may
 *     follow END_INTERFACE"). The LSP reports no line after END_INTERFACE: a library's materialized interface writes
 *     its methods there (`LibSignatureRenderer`) and is never pushed, so the rule needs the file's library-ness;
 *   - under an opening-only NAMESPACE the binder still binds the namespace, so a qualified `NS.F` resolves where
 *     CODESYS declares nothing. Not binding it would not give the diagnostic either: no qualified type name is checked
 *     for being unknown.
 */
import type { Namespace, TopLevel } from "../../ast/nodes.js"
import type { Cursor } from "../cursor.js"
import { joinSpans, type Span } from "../../span.js"
import { vendorTokenText } from "../errors.js"
import { identFromToken } from "../names.js"

export function parseNamespace(c: Cursor, parseInner: (c: Cursor) => TopLevel | undefined): Namespace | undefined {
  const start = c.expectKeyword("NAMESPACE")
  if (start === undefined) return undefined
  const nameTok = c.expectIdent()
  if (nameTok === undefined) return undefined
  const name = identFromToken(nameTok)

  const units: TopLevel[] = []
  while (!c.atEof()) {
    const t = c.peek()
    if (t.kind === "keyword" && t.keyword === "END_NAMESPACE") {
      const closer = c.consume()
      return {
        kind: "namespace",
        name,
        units,
        closer: closer.span,
        span: joinSpans(start.span, closer.span),
      }
    }
    const inner = parseInner(c)
    if (inner !== undefined) {
      units.push(inner)
      continue
    }
    // Unknown token inside namespace — consume one and continue. END_NAMESPACE is no advice: in a POU the
    // push refuses that line (`reportNamespaceClosers`).
    c.pushError(
      `unexpected ${vendorTokenText(t)} inside NAMESPACE — expected POU, TYPE or VAR_GLOBAL`,
      t.span,
    )
    c.consume()
  }
  return { kind: "namespace", name, units, span: units.length === 0 ? start.span : joinSpans(start.span, units.at(-1)!.span) }
}

/** Each written END_NAMESPACE in a POU's units, nested ones included, as the push refuses it. */
export function reportNamespaceClosers(units: readonly TopLevel[], report: (message: string, span: Span) => void): void {
  for (const unit of units) {
    if (unit.kind !== "namespace") continue
    reportNamespaceClosers(unit.units, report)
    if (unit.closer !== undefined)
      report(
        "'END_NAMESPACE' closes no object a workspace file holds: a project has no namespace object (a namespace is a " +
          "library's), so the push refuses the text. Remove the NAMESPACE lines.",
        unit.closer,
      )
  }
}
