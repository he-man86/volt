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
 * EVERY POSITION A DECLARATION WRITES A TYPE IN (`declaredTypes`), one rule for all (openspec dut-unknown-field-type, its
 * class sweep, conformance `declarations/type-references.ts`, CODESYS SP21 2026-10-30): a variable in every VAR section, a
 * STRUCT's and a UNION's field — in the DUT's own file —, an alias's target, a FUNCTION's, a METHOD's and an INTERFACE
 * METHOD's result, a PROPERTY's type; and the name inside an ARRAY, a POINTER or a REFERENCE (`unknownNamedTypes`). One
 * message per thing declared of that type (`DeclaredType.declares`: `a, b : X` is two), on the unknown name itself.
 *
 * This file was `dialect-type`, whose header said a general unknown-type check should not exist because "a name the
 * LSP cannot resolve is usually a library type it cannot see". That was true before libraries were materialized; since
 * then `unresolved-identifier` makes exactly this bet for identifiers, and the corpus gate (every error ⊆ the project's
 * own recorded build) holds this one to it for types.
 */
import type { Scope } from "../../../frontend/symbols/index.js"
import { declaredTypes, type TypeExpr } from "../../../frontend/syntax/index.js"
import { CODESYS_ONLY_TYPES, ELEMENTARY_TYPES } from "../../../frontend/types/index.js"
import { dialectMissingType, unknownNamedTypes, unknownTypeName } from "../../shared/resolution.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { changeToFixes } from "../../shared/near-miss.js"

export function checkUnknownType(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { type, declares } of declaredTypes(ctx.parseResult.units))
    for (const unknown of unknownNamedTypes(ctx.project, type)) {
      const fixes = typeNearMisses(ctx, unknown.type)
      for (let i = 0; i < declares; i++) emit(out, unknown.type.span, "unknown-type", ctx.messages.unknownType(unknown.name), "error", fixes)
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
