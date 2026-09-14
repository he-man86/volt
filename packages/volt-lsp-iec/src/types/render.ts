/**
 * render — the resolved-type renderer (Layer C, C.5): `renderType` displays a `Type`. A declared `TypeExpr` and an
 * expression print through `syntax/print` (`renderTypeExpr`, `exprText`), which read only the AST.
 *
 * Note: compiler-EXACT message forms (e.g. a string literal shown as `STRING(INT#4)`) are diagnostic
 * wording and live in `analysis/messages`, not here — this renderer is the general, human display form.
 */
import { dimText } from "../syntax/index.js"
import { elementaryDisplayName } from "./elementary.js"
import type { Type } from "./type.js"

/** Render a resolved `Type` to display text. */
export function renderType(t: Type): string {
  switch (t.kind) {
    case "elementary": {
      // the compiler's spelling — TOD prints 'TIME_OF_DAY' — and a declared string capacity is part of the type it
      // prints: "Cannot convert type 'WSTRING' to type 'STRING(255)'" (conformance `cc_standard_len_wstring`)
      const name = elementaryDisplayName(t.name)
      return t.length === undefined ? name : `${name}(${t.length})`
    }
    case "enum":
    case "struct":
    case "function_block":
    case "interface":
      return t.name
    case "array":
      return `ARRAY[${t.dims.map(dimText).join(", ")}] OF ${renderType(t.element)}`
    case "pointer":
      return `POINTER TO ${renderType(t.target)}`
    case "reference":
      return `REFERENCE TO ${renderType(t.target)}`
    case "unknown":
      return "?"
  }
}
