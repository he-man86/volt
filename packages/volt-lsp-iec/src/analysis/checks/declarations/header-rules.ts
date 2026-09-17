/**
 * header-rules (declarations/) — POU-header shape rules that a single additive parser field makes visible:
 *   C0096 multiple-inheritance      — an FB `EXTENDS A, B` names more than one base (single inheritance only).
 *   C0182 return-type-not-allowed   — a return type on a POU that isn't a FUNCTION/METHOD (e.g. `PROGRAM P : BOOL`).
 *   C0421 interface-implements       — an INTERFACE using `IMPLEMENTS` where interface inheritance needs `EXTENDS`.
 *   C0144 inheritance-not-allowed    — `EXTENDS` on an enum/alias DUT (inheritance is FB/interface/struct only).
 *   C0542 union-inheritance          — `EXTENDS` on a UNION DUT (unions cannot inherit).
 *   C0145 function-implements        — `IMPLEMENTS` on a FUNCTION (only FBs implement interfaces).
 *   property-without-accessor        — a PROPERTY declaring neither GET nor SET, which nothing can use (a WARNING;
 *          conformance `interface_with_property`).
 *
 * Each reads a field the parser only sets in the illegal case (`extendsExtra` / program `returnType` /
 * `implementsMisused` / `extendsMisused`), so the check is a pure presence test — zero-FP
 * by construction (the corpus, which compiles clean, never sets them).
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"

export function checkHeaderRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
    // A standalone PROPERTY carries its accessors as bodies; an INTERFACE's carries them as flags, since a
    // signature has no body to hold.
    const accessorless =
      unit.kind === "property"
        ? unit.getter === undefined && unit.setter === undefined
          ? [unit.name.span]
          : []
        : unit.kind === "interface"
          ? unit.properties.filter((p) => !p.hasGetter && !p.hasSetter).map((p) => p.name.span)
          : []
    for (const span of accessorless)
      out.push({ severity: "warning", span, source: SOURCE, code: "property-without-accessor", message: ctx.messages.propertyWithoutAccessor() })
    if (unit.kind === "function_block" && unit.extendsExtra !== undefined && unit.extendsExtra.length > 0) {
      // Anchor on the first illegal extra base (the point past the single allowed one).
      out.push({
        severity: "error",
        span: unit.extendsExtra[0]!.span,
        source: SOURCE,
        code: "multiple-inheritance",
        message: ctx.messages.multipleInheritance(),
      })
    } else if (unit.kind === "program" && unit.returnType !== undefined) {
      out.push({
        severity: "error",
        span: unit.returnType.span,
        source: SOURCE,
        code: "return-type-not-allowed",
        message: ctx.messages.returnTypeNotAllowed(),
      })
    } else if (unit.kind === "interface" && unit.implementsMisused !== undefined) {
      out.push({
        severity: "error",
        span: unit.implementsMisused[0]?.span ?? unit.name.span,
        source: SOURCE,
        code: "interface-implements",
        message: ctx.messages.interfaceImplementsMisused(),
      })
    }
    // NOT here: C0149 var-in-interface, a VAR section declared directly in an INTERFACE. The catalog says it is an
    // error and CODESYS SP21 BUILDS IT, reporting nothing at all (conformance `cc2_var_in_interface`, 2026-09-16).
    // The parser still records `strayVarSections`, and NOTHING reads it today — it is kept rather than deleted
    // because the build being clean raises a question nobody has measured: whether an FB implementing such an
    // interface INHERITS those variables. `itf_var_section_inherited` asks it.
    if (unit.kind === "function" && unit.implementsMisused !== undefined) {
      out.push({
        severity: "error",
        span: unit.implementsMisused[0]?.span ?? unit.name.span,
        source: SOURCE,
        code: "function-implements",
        message: ctx.messages.functionImplements(),
      })
    }
    if (unit.kind === "type_decl" && unit.extendsMisused !== undefined) {
      // union → C0542 (a WARNING, kept for backward compat; its message names the type);
      // enum/alias → C0144 (a hard error, the general rule).
      const isUnion = unit.body.kind === "union"
      // C0542 is CODESYS-only: live /build shows TwinCAT silently accepts EXTENDS on a UNION.
      if (isUnion && ctx.config.vendor !== "codesys") continue
      out.push({
        severity: isUnion ? "warning" : "error",
        span: unit.extendsMisused.span,
        source: SOURCE,
        code: isUnion ? "union-inheritance" : "inheritance-not-allowed",
        message: isUnion ? ctx.messages.unionInheritance(unit.extendsMisused.text) : ctx.messages.inheritanceNotAllowed(),
      })
    }
  }
}
