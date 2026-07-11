/**
 * unknown-type (D.2 · names/). A DECLARED type name that resolves NOWHERE — not an elementary/ANY_*
 * primitive, not a project-declared type/FB/interface/enum/struct/alias, not a catalog built-in, not a
 * referenced-library namespace — → error. This is the `x : BOL` typo the compilers reject outright, and
 * the sibling of `unresolved-identifier`: that check covers name refs in bodies, this one covers name refs
 * in type position (VAR decls, return types, property/struct-field types, alias targets, array/pointer
 * element types).
 *
 * Resolution reuses the SAME oracle as `unresolved-identifier` (`nameResolves`) plus the elementary/ANY_*
 * primitives, so the skip surface is identical by construction: a type name this flags is one the compiler
 * would reject, and a library/namespace type it cannot see is one `unresolved-identifier` also cannot see
 * (the shared "library floor"). Two whole-skips keep it zero-FP: a QUALIFIED name (`NS.Type`) — the
 * resolver keys on the last segment only and the root may be a library namespace — and a name resolved by
 * the containing scope, which covers VAR_GENERIC type params (`T : ANY` used as a type in the same POU).
 *
 * PROVISIONAL wording — no live-bridge recording yet (bridge-gated, like `notAMember`/`arrayIndexOutOfBounds`).
 */
import { flatUnits, unitTypeNameRefs } from "../../../syntax/index.js"
import { scopeForUnit } from "../../../symbols/index.js"
import { isKnownPrimitive } from "../../../types/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"
import { nameResolves } from "./_identifier-resolution.js"

export function checkUnknownTypes(ctx: CheckContext, out: DiagnosticItem[]): void {
  if (!ctx.config.lints.unknownType) return // opt-in: FP-prone below the "library floor" (see header)
  for (const unit of flatUnits(ctx.parseResult.units)) {
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    for (const ref of unitTypeNameRefs(unit)) {
      // Only declared TYPE positions (not EXTENDS/IMPLEMENTS bases — those resolve via a different floor);
      // qualified `NS.Type` skipped (the root may be a library namespace the resolver can't see).
      if (ref.position !== "type" || ref.qualified) continue
      if (isKnownPrimitive(ref.name) || nameResolves(ref.name, scope, ctx.project, ctx.references)) continue
      out.push({
        severity: "error",
        span: ref.span,
        source: SOURCE,
        code: "unknown-type",
        message: ctx.messages.unknownType(ref.name),
      })
    }
  }
}
