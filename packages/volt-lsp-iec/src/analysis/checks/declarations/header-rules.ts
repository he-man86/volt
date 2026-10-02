/**
 * header-rules (declarations/) — POU-header shape rules that a single additive parser field makes visible:
 *   C0096 multiple-inheritance      — an FB `EXTENDS A, B` names more than one base (single inheritance only).
 *   C0182 return-type-not-allowed   — a return type on a POU that isn't a FUNCTION/METHOD (e.g. `PROGRAM P : BOOL`).
 *   C0421 interface-implements       — an INTERFACE using `IMPLEMENTS` where interface inheritance needs `EXTENDS`.
 *   C0149 var-in-interface           — a VAR section placed directly in an INTERFACE body (signatures only).
 *   C0144 inheritance-not-allowed    — `EXTENDS` on an alias (with "Keyword EXTENDS not applicable"), or on an enum
 *          whose base is an enum; an enum's other base is one it does not find (both vendors 2026-10-01).
 *   C0542 union-inheritance          — `EXTENDS` on a UNION DUT (unions cannot inherit).
 *   C0145 function-implements        — `IMPLEMENTS` on a FUNCTION (only FBs implement interfaces).
 *   base-class-not-found              — `EXTENDS` on a FUNCTION: a function has no base class, so none is found.
 *   property-without-accessor        — a PROPERTY declaring neither GET nor SET, which nothing can use (a WARNING;
 *          conformance `interface_with_property`).
 *   access-only-on-methods           — PRIVATE or PROTECTED on a FUNCTION_BLOCK, or on an interface member
 *          (`unit_fb_private`, `unit_interface_method_private`; an interface PROPERTY's is CODESYS's alone — TwinCAT
 *          builds it, and a TwinCAT read-back after the push keeps `PROPERTY PRIVATE Val`, 2026-10-01, so the question
 *          reached it).
 *   abstract-and-final               — ABSTRACT and FINAL on one FUNCTION_BLOCK, METHOD or interface METHOD
 *          (`unit_*_abstract_final`).
 *   interface-member-variable        — a variable an interface method declares outside its parameters (both vendors), or
 *          an accessor in a VAR or VAR_INPUT (CODESYS's, `unit_interface_property_accessor_var`).
 *
 * Each reads a field the parser only sets in the illegal case (`extendsExtra` / program `returnType` /
 * `implementsMisused` / `extendsMisused`), so the check is a pure presence test — zero-FP
 * by construction (the corpus, which compiles clean, never sets them).
 */
import type { CheckContext } from "../../diagnostics.js"
import { compilerTypeText, type TypeDecl } from "../../../frontend/syntax/index.js"
import { lookupLocal } from "../../../frontend/symbols/index.js"
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
    // C0149 — a VAR section declared directly in an INTERFACE. This rule was DELETED on 2026-09-16 because
    // `cc2_var_in_interface` builds clean, and restored on 2026-09-17 because that fixture proves nothing: its
    // interface is implemented by NOBODY, so the compiler never looks inside it. `itf_var_section_inherited`
    // adds an FB that implements one, and CODESYS answers "Variable declarations are not allowed in interfaces"
    // — the catalog's own wording. The lesson is the reachability one, not a wording one: a clean build on an
    // unreferenced POU is not evidence that a rule is wrong.
    if (unit.kind === "interface" && unit.strayVarSections !== undefined) {
      for (const section of unit.strayVarSections) {
        out.push({
          severity: "error",
          span: section.span,
          source: SOURCE,
          code: "var-in-interface",
          message: ctx.messages.varInInterface(),
        })
      }
    }
    if (unit.kind === "function" && unit.implementsMisused !== undefined) {
      out.push({
        severity: "error",
        span: unit.implementsMisused[0]?.span ?? unit.name.span,
        source: SOURCE,
        code: "function-implements",
        message: ctx.messages.functionImplements(),
      })
    }
    // A FUNCTION's EXTENDS: a function has no base class, so none is ever found — even a function block of that name
    // (conformance `hdr_function_extends_no_return`, CODESYS SP21 2026-09-30).
    if (unit.kind === "function" && unit.extendsMisused !== undefined) {
      out.push({
        severity: "error",
        span: unit.extendsMisused.span,
        source: SOURCE,
        code: "base-class-not-found",
        message: ctx.messages.baseClassNotFound(unit.extendsMisused.text),
      })
    }
    if (unit.kind === "type_decl" && unit.extendsMisused !== undefined) {
      const base = unit.extendsMisused
      const error = (code: string, message: string) => out.push({ severity: "error", span: base.span, source: SOURCE, code, message })
      if (unit.body.kind === "union") {
        // C0542, a WARNING naming the base — CODESYS-only: TwinCAT silently accepts EXTENDS on a UNION
        // (`unit_type_extends_on_union`, 2026-10-01)
        if (ctx.config.vendor === "codesys")
          out.push({ severity: "warning", span: base.span, source: SOURCE, code: "union-inheritance", message: ctx.messages.unionInheritance(base.text) })
      } else if (unit.body.kind === "enum") {
        // an enum looks for an ENUM base: with one, inheritance is not allowed (`unit_enum_extends_enum`); with any other
        // there is none to find (`unit_type_extends_on_enum`, a struct base)
        if (isEnumType(ctx, base.text)) error("inheritance-not-allowed", ctx.messages.inheritanceNotAllowed())
        else error("base-class-not-found", ctx.messages.baseClassNotFound(base.text))
      } else {
        // an alias, or a TYPE whose body was refused — both vendors give it the alias's two messages
        // (`unit_type_extends_on_alias`, `unit_struct_extends_list`)
        error("inheritance-not-allowed", ctx.messages.extendsNotApplicable(base.text, unit.name.text))
        error("inheritance-not-allowed", ctx.messages.inheritanceNotAllowed())
      }
    }
    // PRIVATE / PROTECTED belong to an FB's methods (and properties) alone
    const accessError = (mods: readonly string[], span: DiagnosticItem["span"]) => {
      if (mods.includes("PRIVATE") || mods.includes("PROTECTED"))
        out.push({ severity: "error", span, source: SOURCE, code: "access-only-on-methods", message: ctx.messages.accessOnlyOnMethods() })
    }
    // (an FB whose header the vendor refused is no FB at all, and gets no message about its header — `headerRefused`)
    if (unit.kind === "function_block" && unit.headerRefused === undefined) accessError(unit.modifiers, unit.name.span)
    if (unit.kind === "interface") {
      for (const m of unit.methods) accessError(m.modifiers, m.name.span)
      // an interface PROPERTY's is CODESYS's alone: `unit_interface_property_private` builds on TwinCAT, and the modifier
      // reached it — a TwinCAT read-back after the push keeps `PROPERTY PRIVATE Val` (2026-10-01)
      if (ctx.config.vendor === "codesys") for (const p of unit.properties) accessError(p.modifiers, p.name.span)
    }
    // A variable an interface METHOD or ACCESSOR declares. An interface METHOD declares parameters alone (both vendors,
    // 2026-10-01 — `unit_interface_method_var_temp`, `_var_stat`, `_var_inst`; its VAR, CODESYS record:exec,
    // `unit_interface_method_override`): every other section's variable is "Only inputs, outputs, and inouts allowed
    // in interface methods", a VAR_TEMP or VAR_INST section is also not allowed in this place, and a VAR_INST is a
    // variable the interface declares. An ACCESSOR's (CODESYS, record:exec — `unit_interface_property_accessor_var`,
    // `_var_input`): a VAR's is refused, a VAR_INPUT echoes the declaration; TwinCAT is unmeasured there — the push
    // refuses to write an accessor's text and TwinCAT has no execution oracle. A bare `VAR END_VAR` is the vendor's
    // own content (pro2193 holds 263) and no error.
    if (unit.kind === "interface") {
      const error = (span: DiagnosticItem["span"], message: string) =>
        out.push({ severity: "error", span, source: SOURCE, code: "interface-member-variable", message })
      for (const m of unit.methods)
        for (const section of m.varSections) {
          if (PARAMETER_SECTIONS.has(section.sectionKind) || section.decls.length === 0) continue
          if (section.sectionKind === "VAR_INST") error(section.span, ctx.messages.varInInterface())
          if (section.sectionKind === "VAR_TEMP" || section.sectionKind === "VAR_INST")
            error(section.span, ctx.messages.sectionNotAllowed(section.sectionKind))
          for (const decl of section.decls) error(decl.span, ctx.messages.onlyParametersInInterfaceMethods())
        }
      if (ctx.config.vendor === "codesys")
        for (const p of unit.properties)
          for (const section of [...p.getterVarSections, ...p.setterVarSections])
            for (const decl of section.decls) {
              if (section.sectionKind === "VAR") error(decl.span, ctx.messages.onlyParametersInInterfaceMethods())
              else if (section.sectionKind === "VAR_INPUT")
                error(decl.span, ctx.messages.inputInPropertyAccessor(`${decl.names.map((n) => n.text).join(", ")} : ${compilerTypeText(decl.type)}`))
            }
      // ABSTRACT with FINAL on an interface METHOD, as on a function block's (`unit_interface_method_abstract_final`)
      for (const m of unit.methods)
        if (m.modifiers.includes("ABSTRACT") && m.modifiers.includes("FINAL"))
          out.push({ severity: "error", span: m.name.span, source: SOURCE, code: "abstract-and-final", message: ctx.messages.abstractAndFinal() })
    }
    if (
      (unit.kind === "method" || (unit.kind === "function_block" && unit.headerRefused === undefined)) &&
      unit.modifiers.includes("ABSTRACT") &&
      unit.modifiers.includes("FINAL")
    )
      out.push({ severity: "error", span: unit.name.span, source: SOURCE, code: "abstract-and-final", message: ctx.messages.abstractAndFinal() })
  }
}

/** The sections an interface METHOD may declare: its parameters. */
const PARAMETER_SECTIONS: ReadonlySet<string> = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"])

/** Whether `name` declares an ENUM type in the project. */
function isEnumType(ctx: CheckContext, name: string): boolean {
  return lookupLocal(ctx.project, name).some((sym) => sym.kind === "type" && (sym.ast as TypeDecl).body.kind === "enum")
}
