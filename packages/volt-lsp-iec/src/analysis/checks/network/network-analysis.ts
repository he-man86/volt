/**
 * network-text diagnostics (Layer F, F.2c) — the graphical branch of the analysis orchestrator. Two streams, both
 * lifted into the same `DiagnosticItem` the ST checks emit so the server merges them onto one
 * `PublishDiagnostics`:
 *   1. STRUCTURAL — the bridge gate's `NETWORK_*` findings (`syntax/network/parser`, a port of the bridge reader, which
 *      asks the POU's scope what the bridge reader asks it, and holds a wire's declared type to its producer as the
 *      reader does). Canonical form is no finding: the push writes any spelling that reads (bridge-refusal-review 2.12).
 *   2. CODE CORRECTNESS — an assign `target := value` is an assignment, so it runs the SAME assignment-type check as ST
 *      (`assignmentPairError`), against a scope where the network's `VAR_TEMP` wires are declared variables. Byte-identical
 *      wording per vendor; the corpus 0-FP gate covers it. The assignments inside EXECUTE boxes are checked too.
 *
 * Type checks mirrored for network text (all share the ST per-pair/per-node helpers so wording stays byte-identical):
 * assignment mismatch + narrowing (`checkStatements`/`checkPair`), binary-operator (`checkBinaryOps`), and
 * conversion-argument narrowing/sign-change (`checkConversionArgs`). ponytail: not every ST type check runs on
 * network text yet — the remainder is added the same way (per-node helper over `operandExprs`) as corpus cases surface.
 *
 * network-undeclared-identifier: an operand naming something declared nowhere reachable — the network-text analogue of
 * ST's unresolved-identifier, sharing its exact resolution rules (`unresolvedInExprs`), against the per-network scope
 * (POU + the network's wires). Error severity, so the corpus 0-FP gate covers it.
 *
 * The checks live by family beside this file: `_labels.ts`, `_boxes.ts` (`???`, pins, `.ENO`), `_operands.ts` (names,
 * members, operators, conversions) and `_assignments.ts` (pairs, holes) — openspec ld-fbd-coverage 2.1.
 */
import { graphicalBodies, type ParseResult } from "../../../frontend/syntax/index.js"
import { analyzeNetworkText } from "../../../frontend/types/index.js"
import type { Scope } from "../../../frontend/symbols/index.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import type { Messages } from "../../messages/index.js"
import { checkHoles, checkStatements } from "./_assignments.js"
import { checkEnoWithoutEn, checkPins, checkUnresolvedBoxes } from "./_boxes.js"
import { checkLabels } from "./_labels.js"
import { checkBinaryOps, checkConversionArgs, checkUndeclared } from "./_operands.js"

/** What the network pass reads of a document: its uri and its parse. */
export interface NetworkTextDocument {
  uri: string
  parseResult: ParseResult
}

export function computeNetworkTextDiagnostics(
  doc: NetworkTextDocument,
  project: Scope,
  messages: Messages,
): DiagnosticItem[] {
  const out: DiagnosticItem[] = []
  for (const { unit, body } of graphicalBodies(doc.parseResult.units)) {
    const analysis = analyzeNetworkText(unit, body, project, doc.uri)
    for (const d of analysis.vg.diagnostics) {
      out.push({ severity: "error", span: d.span, source: SOURCE, code: d.code, message: d.message })
    }
    for (const [network, scope] of analysis.networkScopes) {
      // A DISABLED network is not compiled, so nothing inside it can be a compile error — its `???` included. The flag
      // was parsed and then read by nobody once, which made every disabled network's contents a source of false
      // positives: `ng_network_disabled` puts an undeclared name in one and CODESYS reports nothing at all.
      if (network.disabled) continue
      checkUnresolvedBoxes(network.statements, scope, project, messages, out)
      checkStatements(network.statements, scope, project, messages, out)
      checkBinaryOps(network.statements, scope, project, messages, out)
      checkConversionArgs(network.statements, scope, project, messages, out)
      checkUndeclared(network.statements, scope, project, messages, out)
      checkPins(network.statements, scope, project, messages, out)
      checkEnoWithoutEn(network.statements, scope, project, messages, out)
      checkHoles(network.statements, scope, project, messages, out) // LAST — it reads what the others found
    }

    // Labels are resolved across the WHOLE BODY, not per network — see checkLabels.
    checkLabels(analysis.vg.networks, messages, out)
  }
  return out
}
