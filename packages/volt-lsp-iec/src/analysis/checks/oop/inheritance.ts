/**
 * inheritance (oop/) — resolution + structural checks on an FB's inheritance clauses:
 *   C0091 circular-inheritance — `EXTENDS` names the FB itself (a direct cycle).
 *   C0090 base-class-not-found  — `EXTENDS <name>` where `<name>` resolves to no definition.
 *   C0086 interface-not-found   — `IMPLEMENTS <name>` where `<name>` resolves to no definition.
 *
 * C0090/C0086 reuse the SAME `nameResolves` oracle as `unresolved-identifier`, so the library
 * floor is shared by construction: a base/interface a referenced library provides (namespace root, catalog
 * built-in, or a symbol in scope) resolves and is skipped — only a name that resolves NOWHERE fires. The
 * self-cycle (C0091) is flagged before the not-found check so `EXTENDS FB` on `FB` reports the cycle, not a
 * spurious not-found.
 */
import { isLibrarySymbol, lookup, scopeForUnit } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { nameResolves } from "../../resolution.js"

/** POU kinds an `IMPLEMENTS` name must not be — each disproves "this is an interface". */
const NOT_AN_INTERFACE: ReadonlySet<string> = new Set(["function_block", "function", "program", "dut"])

/** The EXTENDS chain from `start` back to `start`, or undefined when it ends or leaves the project. */
function cycleFrom(start: string, ctx: CheckContext): string[] | undefined {
  const declared = new Map<string, string>()
  for (const u of ctx.parseResult.units) if (u.kind === "function_block" && u.extends !== undefined) declared.set(u.name.text.toUpperCase(), u.extends.text)
  const path: string[] = [start]
  const seen = new Set([start.toUpperCase()])
  for (let next = declared.get(start.toUpperCase()); next !== undefined; next = declared.get(next.toUpperCase())) {
    if (next.toUpperCase() === start.toUpperCase()) return path
    if (seen.has(next.toUpperCase())) return undefined // a cycle that does not include `start` — its own FB reports it
    seen.add(next.toUpperCase())
    path.push(next)
  }
  return undefined
}

export function checkInheritance(ctx: CheckContext, out: DiagnosticItem[]): void {
  const reported = new Set<string>()
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    // A library-provided FB's own EXTENDS/IMPLEMENTS is the library's concern — its base may be another
    // library-internal type `nameResolves` can't see. Only user-project FBs are checked (zero-FP).
    const sym = lookup(ctx.project, unit.name.text)?.symbol
    if (sym !== undefined && isLibrarySymbol(sym)) continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    if (unit.extends !== undefined) {
      // An INDIRECT cycle too — `A EXTENDS B` with `B EXTENDS A` — which CODESYS reports as the whole path
      // (conformance `cc2_circular_inheritance`: "FB_C2_circleA -> FB_C2_circleB -> FB_C2_circleA"). Only the direct
      // self-cycle was found, so an indirect one fell through to the checks below and came out as nonsense: a
      // duplicate-variable error naming the FB as its OWN base. Reported ONCE per cycle, at the first FB of it in this
      // file, as the IDE reports it once for the chain it compiled.
      const cycle = cycleFrom(unit.name.text, ctx)
      if (cycle !== undefined && !reported.has(cycle[0]!.toUpperCase())) {
        for (const name of cycle) reported.add(name.toUpperCase())
        out.push({
          severity: "error",
          span: unit.extends.span,
          source: SOURCE,
          code: "circular-inheritance",
          message: ctx.messages.circularInheritance([...cycle, cycle[0]!].join(" -> ")),
        })
      } else if (cycle !== undefined) {
        continue
      } else if (!nameResolves(unit.extends.text, scope, ctx.project, ctx.references)) {
        // Two errors for a base: the definition it could not find, and the TYPE it therefore does not have. An
        // unresolved INTERFACE gets only the first (conformance `cc2_base_and_interface_not_found`).
        for (const message of [ctx.messages.baseClassNotFound(unit.extends.text), ctx.messages.unknownType(unit.extends.text)])
          out.push({ severity: "error", span: unit.extends.span, source: SOURCE, code: "base-class-not-found", message })
      }
    }
    for (const iface of unit.implements ?? []) {
      // Not found, and ALSO found-but-not-an-interface: `IMPLEMENTS FB_Something` is "No definition found for
      // interface 'FB_Something'" all the same (conformance `cc3_interface_misuse`). Only a PROJECT symbol of a POU
      // kind counts as the disproof — a library symbol's kind is flattened and would false-positive.
      const sym = lookup(scope, iface.text)?.symbol
      const notAnInterface = sym !== undefined && !isLibrarySymbol(sym) && NOT_AN_INTERFACE.has(sym.kind)
      if (notAnInterface || !nameResolves(iface.text, scope, ctx.project, ctx.references))
        out.push({
          severity: "error",
          span: iface.span,
          source: SOURCE,
          code: "interface-not-found",
          message: ctx.messages.interfaceNotFound(iface.text),
        })
    }
  }
}
