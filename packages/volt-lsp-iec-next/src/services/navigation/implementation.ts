/**
 * go-to-implementation (Layer E · E.2). On an INTERFACE → the FBs that `IMPLEMENTS` it; on an
 * interface METHOD → the concrete method of each implementing FB. Walks the workspace for FBs whose
 * implements-list names the interface. Conservative: unresolved cursor → undefined.
 */
import type { Location } from "vscode-languageserver-protocol"
import type { FunctionBlock } from "../../syntax/index.js"
import { findChildScope, lookupLocal, type Scope } from "../../symbols/index.js"
import { locationOf, rangeFromSpan, resolveAt, type Document } from "../shared/index.js"

export function implementation(
  docs: Iterable<Document>,
  project: Scope,
  doc: Document,
  offset: number,
): Location[] | undefined {
  const sym = resolveAt(doc, project, offset)
  if (sym === undefined) return undefined
  const ifaceName = sym.kind === "interface" ? sym.name : sym.kind === "interface_method" ? sym.owner.name : undefined
  if (ifaceName === undefined) return undefined

  const out: Location[] = []
  for (const d of docs) {
    for (const unit of d.parseResult.units) {
      if (unit.kind !== "function_block") continue
      if (!(unit.implements ?? []).some((i) => i.text.toLowerCase() === ifaceName.toLowerCase())) continue
      if (sym.kind === "interface") {
        out.push({ uri: d.uri, range: rangeFromSpan(unit.name.span) })
      } else {
        // interface method → the FB's concrete method of the same name
        const method = findMethod(project, unit, sym.name)
        if (method !== undefined) out.push(method)
      }
    }
  }
  return out
}

function findMethod(project: Scope, fb: FunctionBlock, methodName: string): Location | undefined {
  const fbScope = findChildScope(project, fb.name.text)
  if (fbScope === undefined) return undefined
  const sym = lookupLocal(fbScope, methodName).find((s) => s.kind === "method")
  return sym !== undefined ? locationOf(sym) : undefined
}
