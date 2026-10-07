/**
 * VAR_STAT: one variable per FB type, shared by every instance — a global named for the FB.
 */

import { Lowering } from "../lowering.js"
import type { VarSection } from "../../../frontend/syntax/index.js"
import { declareVars } from "./declare.js"

/**
 * An FB body's VAR_STAT: ONE variable every instance shares — measured, two instances each counting twice read 4
 * (conformance `life_fb_var_stat_instances`) — so a global named for the FB, as a METHOD's VAR_STAT is named for the
 * method. It was laid out as a field of each instance (review 2026-09-15). The body, its methods and derived FBs reach it
 * by its own name (`Lowering.statics`).
 */
export function declareStatics(lw: Lowering, nested: Lowering, fb: string, section: VarSection, statics: { name: string; global: number }[]): void {
  const key = (name: string) => `__${fb}_${name}`.toUpperCase()
  const names = section.decls.flatMap((d) => d.names.map((n) => n.text))
  if (!names.every((n) => lw.shared.globals.byName.has(key(n)))) {
    const global = new Lowering(nested.scope, lw.project, lw.shared)
    global.globalMode = true
    declareVars(global, [{ ...section, decls: section.decls.map((d) => ({ ...d, names: d.names.map((n) => ({ ...n, text: `__${fb}_${n.text}` })) })) }])
    nested.diagnostics.push(...global.diagnostics)
  }
  for (const name of names) {
    const index = lw.shared.globals.byName.get(key(name))
    if (index === undefined) continue
    nested.statics.set(name.toUpperCase(), index)
    statics.push({ name, global: index })
  }
}
