/**
 * render — the resolved-type renderer: `renderType` prints a `Type`, in the human DISPLAY form or in the form a
 * compiler message names it (`form: "compiler"`). A declared `TypeExpr` and an expression print through `syntax/print`
 * (`renderTypeExpr`, `exprText`), which read only the AST.
 *
 * Message forms that are not a type's name — a string literal shown as `STRING(INT#4)`, a subrange `INT (1..100)`, an
 * array with its bounds folded where it is used — are diagnostic wording and live in `analysis/messages`.
 */
import { dimText } from "../syntax/index.js"
import { elementaryDisplayName } from "./elementary.js"
import type { Type } from "./type.js"

/**
 * Render a resolved `Type`. The `compiler` form differs in one measured way: an enum's name is upper-cased —
 * `DUT_LANG_cc_enum_byte` is "Cannot convert type 'DUT_LANG_CC_ENUM_BYTE' to type 'BYTE'" (conformance `cc_enum_into_*`,
 * `cc_enum_compare_two_enums`).
 */
export function renderType(t: Type, options?: { form: "display" | "compiler" }): string {
  if (options?.form === "compiler" && t.kind === "enum") return t.name.toUpperCase()
  switch (t.kind) {
    case "elementary": {
      // the compiler's spelling — TOD prints 'TIME_OF_DAY' — and a declared string capacity is part of the type it
      // prints: "Cannot convert type 'WSTRING' to type 'STRING(255)'" (conformance `cc_standard_len_wstring`)
      const name = elementaryDisplayName(t.name)
      // …and so is a subrange's range, after a space: "Cannot convert type 'INT (0..10)' to type 'STRING'"
      // (`dt_subrange_variable_type`, `subrange_init_above_range`, both vendors)
      if (t.subrange !== undefined) return `${name} (${t.subrange.lower}..${t.subrange.upper})`
      return t.length === undefined ? name : `${name}(${t.lengthText ?? t.length})`
    }
    // a POU denoted by its name is printed upper-cased (`FunctionBlockType` `byName`, rules DT7, DT8)
    case "function_block":
      return t.byName === true ? t.name.toUpperCase() : t.name
    case "enum":
    case "struct":
    case "interface":
      return t.name
    case "array":
      // the IDE writes a SPACE after ARRAY — "The type ARRAY [1..3] OF INT cannot have a default value in
      // this context" (conformance `cc6_function_input_array_default`); no recorded message spells it without one
      return `ARRAY [${t.dims.map(dimText).join(", ")}] OF ${renderType(t.element)}`
    case "pointer":
      return `POINTER TO ${renderType(t.target)}`
    // a name that denotes a declaration is named as the compiler names it, upper-cased (rule DT8, `type` `StaticType`)
    case "static":
      return t.name.toUpperCase()
    case "reference":
      return `REFERENCE TO ${renderType(t.target)}`
    case "unknown":
      return "?"
  }
}
