/**
 * unresolved-identifier (D.2 · names/). A bare identifier reference whose name resolves in NO reachable
 * scope → error `Identifier '<name>' not defined` (byte-identical on both compilers). Mirrors what the
 * IDE rejects; a compiler-parity check, so it runs always. The resolution rules (and the whole skip surface)
 * live in `identifier-resolution` — shared verbatim with the network-text `network-undeclared-identifier` check.
 *
 * A name that does not resolve and is CALLED is two errors, not one: the compiler adds "Program name, function or
 * function block instance expected instead of 'X'" (conformance `cc_conv_spelled_*` — CODESYS has no
 * `TIME_OF_DAY_TO_UDINT`, only `TOD_TO_UDINT`).
 *
 * Emits two codes: `unresolved-identifier` (a bare name — `undefinedIdentifier`) and `unknown-member`
 * (`a.b` where `b` is not on `a`'s type — `unresolvedMembers`/`notAMember`). Member access is conservative:
 * only a PROJECT (non-library) struct/FB/enum base with a fully-resolved EXTENDS chain is checked, so
 * library-typed and namespace-qualified refs never false-positive (see `analysis/resolution.ts`).
 *
 * Bodies with a conditional-compile pragma (`{IF}`/`{ELSIF}`/`{ELSE}`/`{END_IF}`) are SKIPPED whole: the
 * compilers strip dead branches before analysis but we have no preprocessor, so checking would
 * false-positive on stripped-branch references.
 */
import { stmtExprs, walkExpr, walkStatements, type BodySpan } from "../../../syntax/index.js"
import { bodies, forEachDecl, lookupLocal } from "../../../symbols/index.js"
import type { CheckContext } from "../../diagnostics.js"
import { SOURCE, type DiagnosticItem } from "../../diagnostic-item.js"
import { unresolvedInExprs, unresolvedMembers } from "../../resolution.js"

/** `{IF ...}` / `{ELSIF ...}` / `{ELSE}` / `{END_IF}` — permissive on inner leading whitespace. */
const CONDITIONAL_PRAGMA_RE = /^\{\s*(?:IF|ELSIF|ELSE|END_IF)\b/i

export function checkUnresolvedIdentifiers(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A NAME WHOSE DECLARATION FAILED TO PARSE IS NOT UNDEFINED — it is unparsed, and the parse error already said so.
  // CODESYS stops there; we would go on to report every later use, one "not defined" apiece. That cascade is the
  // whole reason the sixteen reserved IL operator names are not in the keyword table: adding them cost 44 LSP-only
  // messages against the 16 real misses they fix (`docs/reserved-il-operators.md`).
  //
  // Suppressing it HERE covers the second message too. "'cal' is no valid assignment target" comes from
  // `unknown-source`, which reports a hole only once an earlier check has EXPLAINED it — and this is that check.
  const unparsed = new Set(ctx.parseResult.failedDeclarations)
  for (const { body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    if (bodyHasConditionalPragma(body)) continue
    walkStatements(statements, (stmt) => {
      const exprs = stmtExprs(stmt)
      const callees = new Set<number>()
      for (const e of exprs) walkExpr(e, (x) => { if (x.kind === "call" && x.callee.kind === "ident_expr") callees.add(x.callee.span.start) })
      for (const ref of unresolvedInExprs(exprs, scope, ctx.project, ctx.references)) {
        if (unparsed.has(ref.name.toLowerCase())) continue
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unresolved-identifier",
          message: ctx.messages.undefinedIdentifier(ref.name),
        })
        if (callees.has(ref.span.start))
          out.push({
            severity: "error",
            span: ref.span,
            source: SOURCE,
            code: "invalid-call-target",
            message: ctx.messages.callTargetExpected(ref.name),
          })
      }
      for (const ref of unresolvedMembers(exprs, scope, ctx.project)) {
        out.push({
          severity: "error",
          span: ref.span,
          source: SOURCE,
          code: "unknown-member",
          message: ctx.messages.notAMember(ref.member, ref.typeName),
        })
      }
    })
  }

  // AND IN A DECLARATION'S INITIALIZER, which this walked past because it walked BODIES. An initializer is not a
  // constant-only place — `other : DINT; n : DINT := other;` compiles on both vendors — so a name is as real there
  // as in a statement, and `n : DINT := nope;` is "Identifier 'nope' not defined" on both
  // (`cc_decl_init_unknown_name`, `cc_decl_init_sibling_var`, 2026-09-21).
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    // an AGGREGATE initializer is a different shape with its own element list, and `struct-init`/`array-init`
    // own it — this is the plain-expression case only
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    for (const ref of unresolvedInExprs([decl.init], scope, ctx.project, ctx.references)) {
      if (unparsed.has(ref.name.toLowerCase())) continue
      // …but a `__` name is the compilers' own namespace, and one they do not know never reaches name resolution
      // here at all — it is a PARSE refusal. `checks/declarations/system-initializer` owns it.
      if (ref.name.startsWith("__")) continue
      // …and a name declared in THIS VERY SCOPE resolves bare even under `{attribute 'qualified_only'}`. That
      // attribute governs access from OUTSIDE the list, and `lookup` drops such a symbol at every level
      // including its own — which never mattered while this walked bodies, because a GVL has no body. The one
      // place a reference can sit INSIDE a qualified-only list is an initializer, and real projects write them:
      // `MaxProductsInMould : UINT := MaxMouldLevels * MaxProductsInX * MaxProductsInY;` in pro2193's
      // `GVL_Constants`, which CODESYS compiles. Ten false positives on the first corpus run.
      if (lookupLocal(scope, ref.name).length > 0) continue
      out.push({ severity: "error", span: ref.span, source: SOURCE, code: "unresolved-identifier", message: ctx.messages.undefinedIdentifier(ref.name) })
    }
  }
}

/** True when the body carries a conditional-compile directive (gates the whole-body skip). */
function bodyHasConditionalPragma(body: BodySpan): boolean {
  return body.tokens.some((t) => t.kind === "pragma" && CONDITIONAL_PRAGMA_RE.test(t.text))
}
