/**
 * unknown-type (declarations/, C0077). A declared type that names nothing: "Unknown type: '<name>'".
 *
 * Two cases, one message, one verdict (`unknownTypeName` in `analysis/shared/resolution.ts`):
 *   - a bare type name nothing declares — no project object, no referenced library, no compiler built-in. Measured on
 *     both vendors (2026-09-30, conformance `objects/written-as-sent.ts`): an FB or a DUT whose object's text declares
 *     nothing — a never-closed `(*`, an empty or prose text, prose above its TYPE — which the push now writes as sent;
 *   - a CODESYS-only ELEMENTARY type on TwinCAT (`LDATE`, `LTOD`/`LTIME_OF_DAY`, `LDT`/`LDATE_AND_TIME`) — 39 messages
 *     across 13 fixtures in its recording, none in CODESYS's (2026-09-20). The conversions that carry them fall out of
 *     `nameResolves`.
 *
 * A FUNCTION's RETURN type is a declaration too, for the dialect half only: TwinCAT reports `FUNCTION F : LDT` on the
 * header (`xf_l*_call_once`, 2026-10-01); a bare unknown name as a return type is recorded on neither vendor.
 *
 * This file was `dialect-type`, whose header said a general unknown-type check should not exist because "a name the
 * LSP cannot resolve is usually a library type it cannot see". That was true before libraries were materialized; since
 * then `unresolved-identifier` makes exactly this bet for identifiers, and the corpus gate (every error ⊆ the project's
 * own recorded build) holds this one to it for types.
 */
import { forEachDecl, type Scope } from "../../../frontend/symbols/index.js"
import type { TypeExpr } from "../../../frontend/syntax/index.js"
import { CODESYS_ONLY_TYPES, ELEMENTARY_TYPES } from "../../../frontend/types/index.js"
import { dialectMissingType, unknownTypeName } from "../../shared/resolution.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { changeToFixes } from "../../shared/near-miss.js"

export function checkUnknownType(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    const name = unknownTypeName(ctx.project, decl.type)
    if (name === undefined) continue
    const fixes = typeNearMisses(ctx, decl.type)
    for (const at of decl.names)
      emit(out, at.span, "unknown-type", ctx.messages.unknownType(name), "error", fixes)
  }
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function" || unit.returnType === undefined) continue
    const name = dialectMissingType(ctx.project, unit.returnType)
    if (name !== undefined)
      emit(out, unit.returnType.span, "unknown-type", ctx.messages.unknownType(name))
  }
}

/**
 * "Change to '<type>'" for a bare type name nothing declares (design.md §4 F3, `qf_c0077_change`): its near misses among
 * the dialect's elementary types and the project's own types — a DUT, a function block, an interface — each one that
 * resolves where it is written. A type the DIALECT lacks (`LDATE` on TwinCAT) is no typo and gets none.
 */
function typeNearMisses(ctx: CheckContext, t: TypeExpr): Fix[] {
  if (t.kind !== "named_type" || (t.qualifiers?.length ?? 0) > 0 || dialectMissingType(ctx.project, t) !== undefined) return []
  return changeToFixes(ctx.source, t.name.span.start, t.name.span.end, typeNames(ctx.project), {
    accept: (name) => unknownTypeName(ctx.project, { ...t, name: { ...t.name, text: name } }) === undefined,
  })
}

const TYPE_KINDS: ReadonlySet<string> = new Set(["type", "function_block", "interface"])

/** The type names a declaration may be a typo for: the dialect's elementary types, then the project's own. */
function* typeNames(project: Scope): Generator<string> {
  for (const name of ELEMENTARY_TYPES.keys()) if (project.dialect === "codesys" || !CODESYS_ONLY_TYPES.has(name)) yield name
  for (const list of project.symbols.values()) for (const sym of list) if (TYPE_KINDS.has(sym.kind)) yield sym.name
}
