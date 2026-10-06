/**
 * inheritance (oop/) — resolution + structural checks on an FB's, an interface's and a STRUCT's inheritance clauses:
 *   C0091 circular-inheritance — an `EXTENDS` cycle, of FBs, interfaces or STRUCTs (`checkCycles`).
 *   C0090 base-class-not-found  — `EXTENDS <name>` (an FB's, an interface's list's) where `<name>` resolves to no definition.
 *   C0086 interface-not-found   — `IMPLEMENTS <name>` where `<name>` resolves to no definition.
 *
 * C0090/C0086 reuse the SAME `nameResolves` oracle as `unresolved-identifier`, so the library
 * floor is shared by construction: a base/interface a referenced library provides (namespace root, catalog
 * built-in, or a symbol in scope) resolves and is skipped — only a name that resolves NOWHERE fires. The
 * self-cycle (C0091) is flagged before the not-found check so `EXTENDS FB` on `FB` reports the cycle, not a
 * spurious not-found.
 */
import { extendsCycle, isLibrarySymbol, lookupUnit, scopeForUnit, type Scope } from "../../../frontend/symbols/index.js"
import type { Identifier, TopLevel } from "../../../frontend/syntax/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { nameResolves } from "../../shared/resolution.js"

/** POU kinds an `IMPLEMENTS` name must not be — each disproves "this is an interface". */
const NOT_AN_INTERFACE: ReadonlySet<string> = new Set(["function_block", "function", "program", "dut"])

/** The first base a unit's EXTENDS names, written: an FB's, a STRUCT's, an interface's list's first. */
function firstBase(unit: TopLevel): Identifier | undefined {
  if (unit.kind === "function_block") return unit.extends
  if (unit.kind === "interface") return unit.extends?.[0]
  if (unit.kind === "type_decl" && unit.body.kind === "struct") return unit.body.extends
  return undefined
}

/**
 * EXTENDS CYCLES, of every kind that extends (rule H9): FBs, INTERFACEs and STRUCTs are all "Recursion in base function
 * block list: A -> B -> A" (`inh_extends_cycle`, `inh_interface_extends_cycle`, `inh_struct_extends_cycle`, both
 * vendors 2026-10-02). The cycle is the one the symbol table LINKED (`extends.ts` `extendsCycle`) — this re-derived
 * the chain by name from the file's FBs alone, so a cycle through an interface or a struct was never seen. Reported ONCE
 * per cycle, at the first unit of it in this file, as the IDE reports it once for the chain it compiled.
 */
function checkCycles(ctx: CheckContext, out: DiagnosticItem[]): Set<Scope> {
  const inCycle = new Set<Scope>()
  for (const unit of ctx.parseResult.units) {
    const base = firstBase(unit)
    if (base === undefined) continue
    const scope = scopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const cycle = extendsCycle(scope)
    if (cycle === undefined) continue
    const seen = cycle.some((s) => inCycle.has(s))
    for (const s of cycle) inCycle.add(s)
    if (!seen)
      out.push({
        severity: "error",
        span: base.span,
        source: SOURCE,
        code: "circular-inheritance",
        message: ctx.messages.circularInheritance(cycle.map((s) => s.name).join(" -> ")),
      })
  }
  return inCycle
}

/**
 * An INTERFACE base that resolves to nothing (rules H4, H7): "No definition found for base class 'I'" as an FB's, and on
 * CODESYS "Unknown type: 'I'" too (`inh_interface_extends_unknown`, both vendors 2026-10-02). Unchecked until the
 * binder linked interface bases.
 */
function checkInterfaceBases(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "interface" || unit.extends === undefined) continue
    const sym = lookupUnit(ctx.project, unit.name.text)?.symbol
    if (sym !== undefined && isLibrarySymbol(sym)) continue
    const scope = scopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    const linked = new Set((scope.interfaceBases ?? []).map((b) => b.name.toLowerCase()))
    for (const b of unit.extends) {
      const name = b.text.slice(b.text.lastIndexOf(".") + 1).toLowerCase()
      if (linked.has(name) || nameResolves(b.text, scope)) continue
      out.push(...baseNotFound(ctx, b))
    }
  }
}

/**
 * A base nothing declares: "No definition found for base class" (C0090, `base-class-not-found`) and, on CODESYS, "Unknown
 * type" (C0077, `unknown-type`) — each sentence under ITS rule's code, so a code filter, the docs link and the config
 * switch name the rule that sentence is. Both went out as `base-class-not-found`, C0090 on the wire for C0077's words.
 */
function baseNotFound(ctx: CheckContext, base: { text: string; span: DiagnosticItem["span"] }): DiagnosticItem[] {
  const at = (code: string, message: string): DiagnosticItem => ({ severity: "error", span: base.span, source: SOURCE, code, message })
  const notFound = at("base-class-not-found", ctx.messages.baseClassNotFound(base.text))
  return ctx.config.vendor === "twincat" ? [notFound] : [notFound, at("unknown-type", ctx.messages.unknownType(base.text))]
}

export function checkInheritance(ctx: CheckContext, out: DiagnosticItem[]): void {
  const inCycle = checkCycles(ctx, out)
  checkInterfaceBases(ctx, out)
  for (const unit of ctx.parseResult.units) {
    if (unit.kind !== "function_block") continue
    // A library-provided FB's own EXTENDS/IMPLEMENTS is the library's concern — its base may be another
    // library-internal type `nameResolves` can't see. Only user-project FBs are checked (zero-FP).
    const sym = lookupUnit(ctx.project, unit.name.text)?.symbol
    if (sym !== undefined && isLibrarySymbol(sym)) continue
    const scope = scopeForUnit(ctx.project, unit) ?? ctx.project
    if (unit.extends !== undefined) {
      // a cycle (`checkCycles`) is reported as the whole path, and no unresolved base besides — an indirect cycle
      // that fell through came out as nonsense: a duplicate-variable error naming the FB as its OWN base
      if (!inCycle.has(scope) && scope.baseScope === undefined && !nameResolves(unit.extends.text, scope)) {
        // the base the symbol table LINKED is the answer first: a qualified library base (`EXTENDS Standard.TON`,
        // `unit_fb_extends_qualified`) resolves there, through its namespace, where a name lookup has no namespace
        // Two errors for a base: the definition it could not find, and the TYPE it therefore does not have. An
        // unresolved INTERFACE gets only the first (conformance `cc2_base_and_interface_not_found`).
        // TWINCAT REPORTS ONLY THE FIRST — same fixture, its recording 2026-09-20: it says the base class is
        // not found and stops, where CODESYS goes on to say the FB therefore has no type.
        out.push(...baseNotFound(ctx, unit.extends))
      }
    }
    for (const iface of unit.implements ?? []) {
      // Not found, and ALSO found-but-not-an-interface: `IMPLEMENTS FB_Something` is "No definition found for
      // interface 'FB_Something'" all the same (conformance `cc3_interface_misuse`). Only a PROJECT symbol of a POU
      // kind counts as the disproof — a library symbol's kind is flattened and would false-positive.
      const sym = lookupUnit(scope, iface.text)?.symbol
      const notAnInterface = sym !== undefined && !isLibrarySymbol(sym) && NOT_AN_INTERFACE.has(sym.kind)
      if (notAnInterface || !nameResolves(iface.text, scope))
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
