/**
 * signature-name (declarations/). The name in a POU's SIGNATURE must be the name of the OBJECT that holds it.
 * CODESYS: "The name used in the signature is not identical to the object name" — measured live on SP21
 * (2026-09-17) by storing `FUNCTION_BLOCK FB_TotallyDifferentName` in an object called `FB_NameMismatch` and
 * building it.
 *
 * The two really are independent: the IDE stored that text verbatim rather than correcting it, so a POU can sit
 * in the tree under one name and call itself another until someone builds. That independence is the whole reason
 * this check exists, and the reason Volt takes an item's IDENTITY from its FILE NAME and never from the
 * declaration text — a rule the recorder was quietly breaking, deriving the pushed item's name from the parsed
 * signature and so "correcting" the one mismatch a fixture might want to record.
 *
 * Only a file holding exactly ONE top-level POU is checked. That is every real workspace file (one item, one
 * file — the protocol invariant) and every corpus file; a conformance fixture may inline its dependencies as
 * extra units, and those legitimately carry names the file is not named after.
 *
 * An INTERFACE is exempt and that is not an assumption: `sn_interface_mismatch_used` adds an FB that implements
 * one and the build is still clean. Measuring it UNREFERENCED would have proved nothing — that is the mistake
 * that deleted C0149 for a day.
 *
 * CODESYS-only: TwinCAT is unmeasured. The rule is structural and almost certainly shared, but "almost
 * certainly" is how a false positive gets written.
 */
import type { Identifier, TopLevel } from "../../../syntax/index.js"
import { scopeForUnit } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

/**
 * The kinds CODESYS holds to the rule, each measured with the object REFERENCED so the compiler actually looks:
 * a FUNCTION_BLOCK, a FUNCTION, a PROGRAM and a DUT all error; an INTERFACE does NOT, even with an FB
 * implementing it (`sn_*_mismatch`, `sn_interface_mismatch_used`, `sn_dut_mismatch_used`). A GVL and a namespace
 * name nothing in their text, so there is nothing to disagree.
 */
const NAMED_POU = new Set(["function_block", "function", "program", "type_decl"])

/** Every kind that is an ITEM of its own — one per file, per the protocol invariant. Members are not these. */
const TOP_LEVEL = new Set(["function_block", "function", "program", "interface", "global_var_list", "type_decl", "namespace"])

export function checkSignatureName(ctx: CheckContext, out: DiagnosticItem[]): void {
  // ONE ITEM, ONE FILE — so a source holding two of them is a fixture packing its dependencies inline, and the
  // file is named after only one of them. Counting NAMED POUs alone was not enough: a fixture pairing a GVL with
  // an FB has one named POU and is still named after the GVL.
  const tops = ctx.parseResult.units.filter((u) => TOP_LEVEL.has(u.kind))
  if (tops.length !== 1) return
  const unit = tops[0]!
  if (!NAMED_POU.has(unit.kind) || !("name" in unit)) return
  const named = unit as TopLevel & { name: Identifier }
  const uri = scopeForUnit(ctx.project, named)?.defUri
  if (uri === undefined) return
  const object = objectName(uri)
  if (object === undefined || object.toLowerCase() === named.name.text.toLowerCase()) return
  out.push({
    severity: "error",
    span: named.name.span,
    source: SOURCE,
    code: "signature-name-mismatch",
    message: ctx.messages.signatureNameMismatch(),
  })
}

/** The object's name: the file's base name without its kind extension. */
function objectName(uri: string): string | undefined {
  const base = uri.split(/[\\/]/).pop()
  if (base === undefined || base.length === 0) return undefined
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? base : base.slice(0, dot)
}
