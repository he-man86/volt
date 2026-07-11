/**
 * header-rules (declarations/) — POU-header shape rules that a single additive parser field makes visible:
 *   C0096 multiple-inheritance      — an FB `EXTENDS A, B` names more than one base (single inheritance only).
 *   C0182 return-type-not-allowed   — a return type on a POU that isn't a FUNCTION/METHOD (e.g. `PROGRAM P : BOOL`).
 *   C0421 interface-implements       — an INTERFACE using `IMPLEMENTS` where interface inheritance needs `EXTENDS`.
 *   C0149 var-in-interface           — a VAR section placed directly in an INTERFACE body (signatures only).
 *   C0144 inheritance-not-allowed    — `EXTENDS` on an enum/alias DUT (inheritance is FB/interface/struct only).
 *   C0542 union-inheritance          — `EXTENDS` on a UNION DUT (unions cannot inherit).
 *   C0145 function-implements        — `IMPLEMENTS` on a FUNCTION (only FBs implement interfaces).
 *
 * Each reads a field the parser only sets in the illegal case (`extendsExtra` / program `returnType` /
 * `implementsMisused` / `strayVarSections` / `extendsMisused`), so the check is a pure presence test — zero-FP
 * by construction (the corpus, which compiles clean, never sets them).
 */
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../_shared.js"

export function checkHeaderRules(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of ctx.parseResult.units) {
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
    // Independent of the above (an interface can misuse IMPLEMENTS *and* declare VARs) — flag each stray section.
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
