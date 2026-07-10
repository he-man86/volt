/**
 * persistent-address (C0215 · declarations/). A variable with a direct-address binding (`AT %…`) in a
 * PERSISTENT var list is illegal — persistent variables live in the retain/persistent memory area, which is
 * incompatible with a fixed I/O address. CODESYS: "Direct address declaration is not possible in persistent list".
 *
 * Zero-FP: fires only when a section is explicitly `PERSISTENT` AND a declaration in it carries an `AT` clause
 * (the parser sets `decl.at` only when one is present). A normal persistent var (no `AT`) and an AT-mapped var
 * in a non-persistent section both stay silent.
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkPersistentAddress(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (!("varSections" in unit)) continue
    for (const section of unit.varSections) {
      if (section.persistent !== true) continue
      for (const decl of section.decls) {
        if (decl.at === undefined) continue
        out.push({
          severity: "error",
          span: decl.at.span,
          source: SOURCE,
          code: "persistent-direct-address",
          message: ctx.messages.persistentDirectAddress(),
        })
      }
    }
  }
}
