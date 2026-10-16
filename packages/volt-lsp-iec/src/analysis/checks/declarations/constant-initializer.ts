/**
 * constant-initializer (C0228 · declarations/). A `CONSTANT` variable declared without an initial value —
 * a constant should be given its value inline. CODESYS: "No initial value for constant variable '<name>'".
 * A WARNING, not an error (live-confirmed on the bakon-nano build) — the constant defaults, so it compiles.
 *
 * Zero-FP: fires for a declaration in a LOCAL/GLOBAL `CONSTANT` section (`VAR`/`VAR_GLOBAL`) with no
 * initializer — of ANY resolvable value type (elementary OR struct/array/enum/union: live-confirmed on
 * bakon-nano, CODESYS warns on `defaultXYA : XYA_Target` too). A `VAR_INPUT CONSTANT` takes its value from the
 * caller and is skipped; an unresolvable/library type is skipped (zero-FP — can't know its shape); an
 * FB-typed "constant" is skipped (not a value type).
 */
import { isIntegerType, resolveTypeExpr, type Type } from "../../../frontend/types/index.js"
import type { TypeExpr } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { forEachDecl } from "../../../frontend/symbols/index.js"
import { emit, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, insertText } from "../../shared/fixes.js"

const INLINE_CONST_SECTIONS = new Set(["VAR", "VAR_GLOBAL"])

export function checkConstantInitializer(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.constant !== true || !INLINE_CONST_SECTIONS.has(section.sectionKind)) continue
    if (decl.init !== undefined) continue
    const resolved = resolveTypeExpr(decl.type, ctx.project, 0, ctx.project, ctx.uri)
    const t = resolved.kind
    if (t === "unknown" || t === "function_block" || t === "interface") continue // unresolvable/non-value → skip (zero-FP)
    const fix = initializeFix(ctx, decl.type, resolved)
    for (const name of decl.names)
      emit(
        out,
        name.span,
        "constant-no-initial-value",
        ctx.messages.constantNoInitialValue(name.text),
        "warning",
        [fix],
      )
  }
}

/**
 * C0228's fix (design.md §4 F7): `:= <the value the constant already runs with>`, written after its type, so the fix
 * changes nothing the program does (`preferred`). That value is its BASE type's zero — an alias's own initial value is
 * not it (`qf_c0228_initialize_alias`: `:= 0`, not 42) — and a NAMED subrange's lower bound (`_subrange`: `:= 3`). An
 * INLINE subrange that excludes 0 runs at 0, which `:= 0` is refused as (`qf_c0228_before_inline_subrange`), so it gets
 * none. Only the integer types are recorded; any other base gets none.
 */
function initializeFix(ctx: CheckContext, written: TypeExpr, t: Type): Fix | undefined {
  if (t.kind !== "elementary" || !isIntegerType(t.name)) return undefined
  const inline = written.kind === "named_type" && written.subrange !== undefined
  const range = t.subrange
  let value: bigint = 0n
  if (range !== undefined && !inline) value = range.lower
  else if (range !== undefined && (range.lower > 0n || range.upper < 0n)) return undefined
  return fixOf(`Initialize with ':= ${value}'`, [insertText(ctx.source, written.span.end, ` := ${value}`)], true)
}
