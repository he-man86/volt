/**
 * external-non-input-write (D.2 · oop/). Flags `fb.internalVar := x` — writing an FB instance's
 * member that is not externally writable. Per doc 02-variables, only VAR_INPUT/VAR_OUTPUT are
 * reachable via `fb.x`; a plain VAR (or VAR_STAT/TEMP/INST) is internal. BOTH vendors reject with
 * the identical `'X' is no input of '<FB>'` (verified live 2026-07-05).
 *
 * Conservative: flags only a member write whose base infers to an FB, whose member is project-local
 * (library sections flatten — unreliable), and whose section is neither input nor output. Anything
 * uncertain skips → zero FP.
 */
import { isSelfRef, walkStatements } from "../../../frontend/syntax/index.js"
import { bodies, isLibrarySymbol } from "../../../frontend/symbols/index.js"
import { inferExprType, isSfcStepBase, memberScopeOf, resolveMemberChain } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, type DiagnosticItem } from "../../shared/diagnostic-item.js"

export function checkExternalNonInputWrite(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    walkStatements(statements, (s) => {
      if (s.kind !== "assign" || s.op !== undefined) return // plain `:=` only
      if (s.target.kind !== "member") return
      if (isSelfRef(s.target.base)) return // writing your own member (THIS/SUPER) is legal
      // a STEP of an SFC program or instance written through it (`PRG.S_Boot.x := TRUE`) is internal to its POU, as a
      // plain VAR is: "'S_Boot' is no input of 'PRG'" (`sfc_step_written_from_outside`, CODESYS 2026-10-03; `types/infer/sfc-step`)
      // — but through THIS^ an SFC FB writes its OWN step (`sfc_step_this_step`, builds)
      const step = s.target.base
      if (step.kind === "member" && !isSelfRef(step.base) && isSfcStepBase(s.target, scope, ctx.project)) {
        const pou = memberScopeOf(inferExprType(step.base, scope, ctx.project))!
        out.push({ severity: "error", span: s.target.span, source: SOURCE, code: "external-non-input-write", message: ctx.messages.noInput(step.member.name, pou.name) })
        return
      }
      // a REFERENCE TO the FB is read through: `rf.k := 5` is no input of it, as `sb.k := 5` is (rule M3,
      // `mem_reference_to_fb_member_write`, both vendors 2026-10-02)
      const written = inferExprType(s.target.base, scope, ctx.project)
      const baseType = written.kind === "reference" ? written.target : written
      if (baseType.kind !== "function_block") return // struct/unknown → skip
      const sym = resolveMemberChain(s.target, scope, ctx.project)
      if (sym === undefined || isLibrarySymbol(sym)) return // library sections are lossy → can't decide
      const section = sym.varSection
      // VAR_INPUT / VAR_OUTPUT are externally writable; no section = not a variable; everything else internal.
      if (section === undefined || section === "VAR_INPUT" || section === "VAR_OUTPUT") return
      // VAR_IN_OUT external access (read OR write) is owned by inout-external-access (C0178) — cede it here.
      if (section === "VAR_IN_OUT") return
      const fbName = baseType.scope?.name ?? baseType.name
      out.push({
        severity: "error",
        span: s.target.span,
        source: SOURCE,
        code: "external-non-input-write",
        message: ctx.messages.noInput(s.target.member.name, fbName),
      })
    })
  }
}

