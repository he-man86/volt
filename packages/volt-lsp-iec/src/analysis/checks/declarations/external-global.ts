/**
 * external-global (declarations/) — C0237. A `VAR_EXTERNAL` re-declares a global so a POU can reference it; if no list
 * declares a variable of the name that a bare name reaches (`symbols/scope-nav` `externalGlobal`: a `qualified_only`
 * list's is none, rule Y13), the reference is dangling. Wording CODESYS-verified (2026-07-11 live).
 *
 * NOT here: C0236 (VAR_EXTERNAL type ≠ VAR_GLOBAL type) — the live IDE does NOT flag it (builds clean), so an
 * offline check would be a false positive. See the catalog C0236 note.
 *
 * A dangling one binds NOTHING: the compiler answers `Identifier 'g_i' not defined` at every use and carries the hole on
 * from there (conformance `cc2_constant_and_external`, where one dangling name accounts for six of the ten recorded
 * errors). That is the search order's to say, not this check's — `lookup` passes over a VAR_EXTERNAL with no global
 * (frontend-conformance 3.1.3), so `unresolved-identifier` reports each use; a separate walk here reported them twice
 * once it did (the `analysis/lost-declaration` module, deleted).
 */
import { lex, parseExprFromTokens, walkAllExprs, type Dialect, type Expr, type Identifier } from "../../../frontend/syntax/index.js"
import { bodies, externalGlobal, forEachDecl, type Scope } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"
import { replaceText } from "../../shared/fixes.js"
import { changeToFixes } from "../../shared/near-miss.js"
import { nameResolves, unresolvedMembers } from "../../shared/resolution.js"

export function checkExternalGlobal(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const { section, decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    if (section.sectionKind !== "VAR_EXTERNAL") continue
    for (const name of decl.names) {
      // an instance PATH (`PLC_PRG.inst.y`) is no global's name: CODESYS builds it with no "No global definition"
      // (`dp_var_external_dotted`, 2026-10-29) — and reads it as the member access it spells, "'nope' is no component of
      // 'FB'" for a member the type does not have (`dp_var_external_dotted_unknown`)
      if (name.text.includes(".")) {
        for (const ref of unresolvedMembers([pathExpr(ctx.source, name, ctx.parseResult.dialect)].filter((e) => e !== undefined), ctx.project, ctx.project))
          emit(out, ref.span, "unknown-member", ctx.messages.notAMember(ref.member, ref.typeName))
        continue
      }
      if (externalGlobal(ctx.project, name.text) !== undefined) continue
      emit(
        out,
        name.span,
        "external-no-global",
        ctx.messages.externalNoGlobal(name.text),
        "error",
        changeToFixes(ctx.source, name.span.start, name.span.end, globalNames(ctx.project), {
            accept: (g) => externalGlobal(ctx.project, g) !== undefined,
            more: (g) => usesOf(ctx, name, scope).map((u) => replaceText(ctx.source, u.start, u.end, g)),
          }),
      )
    }
  }
}

/** Every global variable's name — the candidates a VAR_EXTERNAL may have misspelled. */
function* globalNames(project: Scope): Generator<string> {
  for (const list of project.symbols.values()) for (const sym of list) if (sym.kind === "gvl_var") yield sym.name
}

/**
 * The uses of a DANGLING external in the bodies its unit's scope reaches (C0237's fix renames them with the declaration,
 * `qf_c0237_change`): a dangling VAR_EXTERNAL binds nothing, so each use is a bare name of its spelling that resolves to
 * nothing (`lookup` passes over it — header) — renaming only the declaration would leave every one of them undefined.
 */
function usesOf(ctx: CheckContext, external: Identifier, unitScope: Scope): { start: number; end: number }[] {
  const key = external.text.toLowerCase()
  const uses: { start: number; end: number }[] = []
  for (const { scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (!within(scope, unitScope)) continue
    walkAllExprs(statements, (x) => {
      if (x.kind === "ident_expr" && x.name.toLowerCase() === key && !nameResolves(x.name, scope)) uses.push({ start: x.span.start, end: x.span.end })
    })
  }
  return uses
}

/** Is `scope` `outer` or nested in it? */
/** A declared PATH (`PLC_PRG.inst.y`) as the member access it spells, at the name's own place in the document: the text
 *  before it blanked (line ends kept), so every span is the document's. */
function pathExpr(source: string, name: Identifier, dialect: Dialect): Expr | undefined {
  const before = source.slice(0, name.span.start).replace(/[^\r\n]/g, " ")
  const tokens = lex(before + name.text, dialect).filter((t) => t.kind !== "whitespace" && t.kind !== "eof")
  return parseExprFromTokens(tokens)
}

function within(scope: Scope, outer: Scope): boolean {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) if (s === outer) return true
  return false
}

