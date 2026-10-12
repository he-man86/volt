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
 * library-typed and namespace-qualified refs never false-positive (see `analysis/shared/resolution.ts`).
 *
 * A body is the tree its conditional pragmas compile (`bodies()`): a branch not taken is not in it, so a name only
 * that branch uses is never asked (frontend-conformance 2.7.1 — this check used to skip every body holding an `{IF}`).
 */
import { isSelfRef, stmtExprs, walkExpr, walkStatements, type Expr, type Span, type Statement, type TopLevel, type VarSection } from "../../../frontend/syntax/index.js"
import { bodies, forEachDecl, lookupLocal, lookupMember, visibleNames, type Scope, type Symbol, type SymbolKind } from "../../../frontend/symbols/index.js"
import { elementaryRef, inferExprType, resolveBareName, resolveCallee, resolveMemberChain, resolveTypeExpr, untypedNumberValue, type Type } from "../../../frontend/types/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { compilerExprText } from "../../shared/expr-echo.js"
import { fixOf, insertText, lineBreakOf } from "../../shared/fixes.js"
import { changeToFixes } from "../../shared/near-miss.js"
import { nameResolves, pointerMemberBases, unresolvedInExprs, unresolvedMembers } from "../../shared/resolution.js"

export function checkUnresolvedIdentifiers(ctx: CheckContext, out: DiagnosticItem[]): void {
  // A NAME WHOSE DECLARATION FAILED TO PARSE IS NOT UNDEFINED — it is unparsed, and the parse error already said so.
  // CODESYS stops there; we would go on to report every later use, one "not defined" apiece. That cascade is the
  // whole reason the sixteen reserved IL operator names are not in the keyword table: adding them cost 44 LSP-only
  // messages against the 16 real misses they fix (`docs/reserved-il-operators.md`).
  //
  // Suppressing it HERE covers the second message too. "'cal' is no valid assignment target" comes from
  // `unknown-source`, which reports a hole only once an earlier check has EXPLAINED it — and this is that check.
  const unparsed = new Set(ctx.parseResult.failedDeclarations)
  for (const { unit, body, scope, statements } of bodies(ctx.parseResult.units, ctx.project)) {
    // a name is declared in the unit whose OWN body uses it — a POU's or a method's, not an accessor's
    const owner = "body" in unit && unit.body === body && "varSections" in unit ? unit : undefined
    walkStatements(statements, (stmt) => statementFindings(ctx, stmt, scope, owner, unparsed, out))
  }
  initializerFindings(ctx, unparsed, out)
}

/** The unresolved names, members and global-namespace names of one statement's expressions. */
function statementFindings(
  ctx: CheckContext,
  stmt: Statement,
  scope: Scope,
  owner: DeclaringUnit | undefined,
  unparsed: ReadonlySet<string>,
  out: DiagnosticItem[],
): void {
  const exprs = stmtExprs(stmt)
  const callees = new Set<number>()
  // a called MEMBER, by its member name's start: an unknown one is no call target either, named as written —
  // "Program name, function or function block instance expected instead of 'sb.Nope'" (rule M1,
  // `mem_unknown_method_of_fb_instance`, `mem_unknown_method_of_interface`, both vendors 2026-10-02)
  // — off the recorded bases only: a variable that IS an FB instance or an interface. A global list's member called
  // (`GVL_X.nope()`) and a dereferenced pointer's (`p^.Nope()`) are unasked (step 3 review, 2026-10-03).
  const calledMembers = new Map<number, Expr>()
  for (const e of exprs)
    walkExpr(e, (x) => {
      if (x.kind !== "call") return
      if (x.callee.kind === "ident_expr") callees.add(x.callee.span.start)
      else if (x.callee.kind === "member" && x.callee.base.kind === "ident_expr") {
        const base = inferExprType(x.callee.base, scope, ctx.project).kind
        if (base === "function_block" || base === "interface") calledMembers.set(x.callee.member.span.start, x.callee)
      }
    })
  const uses = usesOf(stmt, exprs)
  for (const ref of unresolvedInExprs(exprs, scope)) {
    if (unparsed.has(ref.name.toLowerCase())) continue
    out.push(
      withFixes(
        { severity: "error", span: ref.span, source: SOURCE, code: "unresolved-identifier", message: ctx.messages.undefinedIdentifier(ref.name) },
        [
          ...changeToFixes(ctx.source, ref.span.start, ref.span.end, valueNames(scope), {
            accept: (name) => nameResolves(name, scope) && bareFits(name, uses.of(ref.span.start), scope, ctx.project),
          }),
          declareFix(ctx, stmt, ref, scope, owner),
        ],
      ),
    )
    if (callees.has(ref.span.start))
      out.push({
        severity: "error",
        span: ref.span,
        source: SOURCE,
        code: "invalid-call-target",
        message: ctx.messages.callTargetExpected(ref.name),
      })
  }
  // `.name`, the global-namespace operator: the GLOBAL namespace only, so a local of the name does not answer it
  // (rule E33, `GlobalExpr`; `expr_global_namespace_undefined`, `_local_only`, both vendors 2026-10-02)
  for (const e of exprs)
    walkExpr(e, (x) => {
      if (x.kind !== "global_expr" || resolveMemberChain(x, scope, ctx.project) !== undefined) return
      out.push({ severity: "error", span: x.span, source: SOURCE, code: "unresolved-identifier", message: ctx.messages.noGlobalDefinition(x.name.name) })
    })
  for (const ref of unresolvedMembers(exprs, scope, ctx.project)) {
    // its fix: each near-miss member of the type, with what it inherits (`qf_c0004_change`)
    const members = ref.members
    out.push(
      withFixes(
        { severity: "error", span: ref.span, source: SOURCE, code: "unknown-member", message: ctx.messages.notAMember(ref.member, ref.typeName) },
        members === undefined
          ? []
          : changeToFixes(ctx.source, ref.span.start, ref.span.end, memberNames(members), {
              accept: (name) => memberFits(lookupMember(members, name), uses.of(ref.span.start), uses.selfBased.has(ref.span.start)),
            }),
      ),
    )
    const called = calledMembers.get(ref.span.start)
    if (called !== undefined)
      out.push({ severity: "error", span: called.span, source: SOURCE, code: "invalid-call-target", message: ctx.messages.callTargetExpected(compilerExprText(called)) })
  }
  // a POINTER read without its `^` has no members: "'p' is no structured variable" (rule M3,
  // `mem_pointer_member_without_deref`, both vendors 2026-10-02) — THIS's and SUPER's sentence, under their code
  for (const base of pointerMemberBases(exprs, scope, ctx.project))
    out.push({ severity: "error", span: base.span, source: SOURCE, code: "self-not-structured", message: ctx.messages.notStructuredVariable(compilerExprText(base)) })
}

/**
 * HOW a name is used where it is written — what a near miss must be able to stand for (§3: its AFTER builds clean). A
 * name read as a value is no FUNCTION, PROGRAM, ACTION or METHOD (`total := Countr` → `Counter`, a FUNCTION, is "Cannot
 * convert type 'COUNTER'"); a called one is no plain variable (`countr()` → `counter : INT` is "no call target"); a
 * written one is no constant; a member read is no METHOD (`f.Exeute` → "referenced without parens"), and a member written
 * from outside an FB is its VAR_INPUT or a property (`f.otp := 1` → a VAR_OUTPUT is "no input of").
 */
type Use = "read" | "call" | "write" | "base"

interface Uses {
  /** The use of the name (or member name) starting at `start`. */
  of(start: number): Use
  /** Member names whose base is THIS^/SUPER^ — the FB's own members, written from inside. */
  selfBased: ReadonlySet<number>
}

function usesOf(stmt: Statement, exprs: readonly Expr[]): Uses {
  const use = new Map<number, Use>()
  const selfBased = new Set<number>()
  const head = (e: Expr): number => (e.kind === "member" ? e.member.span.start : e.span.start)
  for (const e of exprs)
    walkExpr(e, (x) => {
      if (x.kind === "call" && (x.callee.kind === "ident_expr" || x.callee.kind === "member")) use.set(head(x.callee), "call")
      if (x.kind === "member") {
        if (x.base.kind === "ident_expr" && !use.has(x.base.span.start)) use.set(x.base.span.start, "base")
        if (isSelfRef(x.base)) selfBased.add(x.member.span.start)
      }
    })
  if (stmt.kind === "assign")
    for (const t of [stmt.target, ...(stmt.chained ?? [])]) if (t.kind === "ident_expr" || t.kind === "member") use.set(head(t), "write")
  return { of: (start) => use.get(start) ?? "read", selfBased }
}

/** Can the bare name `name` stand for `use` (`Use`)? */
function bareFits(name: string, use: Use, scope: Scope, project: Scope): boolean {
  const found = resolveBareName(scope, name)
  if (found.kind === "enum-member") return use === "read"
  if (found.kind === "device") return use === "read" || use === "base"
  if (found.kind !== "declared") return false
  const sym = found.symbol
  const variable = sym.kind === "var" || sym.kind === "method_param" || sym.kind === "gvl_var"
  switch (use) {
    case "call":
      if (sym.kind === "function" || sym.kind === "program" || sym.kind === "action" || sym.kind === "method") return true
      // an FB INSTANCE is called by its name
      return variable && sym.typeExpr !== undefined && resolveTypeExpr(sym.typeExpr, project, 0, project).kind === "function_block"
    case "write":
      return (variable && sym.constant !== true) || sym.kind === "property"
    case "base":
      return variable || sym.kind === "property" || sym.kind === "program"
    case "read":
      return variable || sym.kind === "property" || sym.kind === "enum_value"
  }
}

/** Can the member `sym` stand for `use` — written from outside unless `self` (`THIS^.x`)? */
function memberFits(sym: Symbol | undefined, use: Use, self: boolean): boolean {
  if (sym === undefined) return false
  const property = sym.kind === "property" || sym.kind === "interface_property"
  const variable = sym.kind === "var" || sym.kind === "struct_field"
  switch (use) {
    case "call":
      return sym.kind === "method" || sym.kind === "interface_method" || sym.kind === "action"
    case "write":
      // from outside an FB only a VAR_INPUT is written (`external-write`); a struct field has no section
      return property || (variable && (self || sym.varSection === undefined || sym.varSection === "VAR_INPUT"))
    case "base":
    case "read":
      // a VAR_IN_OUT is not reached from outside at all (C0178)
      return property || sym.kind === "enum_value" || (variable && (self || sym.varSection !== "VAR_IN_OUT"))
  }
}

/** A unit that declares its own locals — the one a "Declare" fix writes into. */
type DeclaringUnit = Extract<TopLevel, { varSections: VarSection[] }>

/** The symbol kinds a bare name in a body may be a typo for — values, never a type. */
const VALUE_KINDS: ReadonlySet<SymbolKind> = new Set(["var", "method_param", "gvl_var", "enum_value", "property", "function", "program", "action", "method", "device"])

/** Every member name of a type's member scope and its bases (the near-miss candidates for C0004). */
function* memberNames(members: Scope): Generator<string> {
  for (const sym of visibleNames(members, false)) yield sym.name
}

/** Every value name `scope` reaches, outward to the project (the near-miss engine's candidates for C0046). */
function* valueNames(scope: Scope): Generator<string> {
  for (const sym of visibleNames(scope, true)) if (VALUE_KINDS.has(sym.kind)) yield sym.name
}

/**
 * "Declare '<name>' : <T>" (design.md §4 F3): a local VAR of the type the USE gives — the other side of a plain
 * assignment (`total := cap`, `out := level`), the input a named argument feeds (`F(factor := amount)`), BOOL for a
 * condition (`IF ready THEN`). Recorded building: `qf_c0046_declare_target`, `_value`, `_argument`, `_condition`. No type
 * from the use — the other side undeclared too (`qf_c0046_absent_declare`), an untyped literal, a type that is no plain
 * elementary one — and no fix: a declaration would guess it. It goes at the end of the unit's first plain VAR section;
 * a unit without one gets none.
 */
function declareFix(ctx: CheckContext, stmt: Statement, ref: { name: string; span: Span }, scope: Scope, owner: DeclaringUnit | undefined): Fix | undefined {
  if (owner === undefined) return undefined
  const type = typeName(useType(stmt, ref.span.start, scope, ctx.project))
  const section = owner.varSections.find((s) => s.sectionKind === "VAR" && s.constant !== true && s.retain !== true && s.persistent !== true)
  if (type === undefined || section === undefined) return undefined
  const endVar = section.span.end - "END_VAR".length
  if (ctx.source.slice(endVar, section.span.end).toUpperCase() !== "END_VAR") return undefined
  let lineStart = endVar
  while (lineStart > 0 && (ctx.source[lineStart - 1] === " " || ctx.source[lineStart - 1] === "\t")) lineStart--
  if (lineStart > 0 && ctx.source[lineStart - 1] !== "\n") return undefined
  const first = section.decls[0]?.names[0]?.span
  const indent = first === undefined ? "\t" : ctx.source.slice(ctx.source.lastIndexOf("\n", first.start - 1) + 1, first.start)
  const declaration = `${/^[ \t]*$/.test(indent) ? indent : "\t"}${ref.name} : ${type};${lineBreakOf(ctx.source)}`
  return fixOf(`Declare '${ref.name}' : ${type}`, [insertText(ctx.source, lineStart, declaration)])
}

/** The type the use at `at` gives the name standing there — see `declareFix`. */
function useType(stmt: Statement, at: number, scope: Scope, project: Scope): Type | undefined {
  const here = (e: Expr | undefined): boolean => e !== undefined && e.kind === "ident_expr" && e.span.start === at
  if (stmt.kind === "assign" && stmt.op === undefined && (stmt.chained?.length ?? 0) === 0) {
    if (here(stmt.target)) return untypedNumberValue(stmt.value) !== undefined ? undefined : inferExprType(stmt.value, scope, project)
    if (here(stmt.value)) return inferExprType(stmt.target, scope, project)
  }
  const BOOL = elementaryRef("BOOL")
  if (stmt.kind === "if" && stmt.branches.some((b) => here(b.cond))) return BOOL
  if (stmt.kind === "while" && here(stmt.cond)) return BOOL
  if (stmt.kind === "repeat" && here(stmt.until)) return BOOL
  let found: Type | undefined
  for (const e of stmtExprs(stmt))
    walkExpr(e, (x) => {
      if (found !== undefined || x.kind !== "call") return
      const arg = x.args.find((a) => here(a.value) && a.param !== undefined && a.output !== true)
      if (arg === undefined) return
      const param = resolveCallee(x, scope, project)?.params.find((p) => p.name.text.toLowerCase() === arg.param!.name.toLowerCase())
      if (param !== undefined) found = resolveTypeExpr(param.type, project, 0, project)
    })
  return found
}

/** A plain elementary type as a declaration writes it — `INT`, `STRING(6)` — or undefined for anything else. Never BIT:
 *  a BIT local is refused outside an FB and a struct (C0203, `bit-usage.ts`), and no other place is recorded. */
function typeName(t: Type | undefined): string | undefined {
  if (t === undefined || t.kind !== "elementary" || t.subrange !== undefined || t.unfoldedLength === true || t.lengthText !== undefined) return undefined
  if (t.name.toUpperCase() === "BIT") return undefined
  return t.length === undefined ? t.name : `${t.name}(${t.length})`
}

/**
 * AND IN A DECLARATION'S INITIALIZER, which this walked past because it walked BODIES. An initializer is not a
 * constant-only place — `other : DINT; n : DINT := other;` compiles on both vendors — so a name is as real there
 * as in a statement, and `n : DINT := nope;` is "Identifier 'nope' not defined" on both
 * (`cc_decl_init_unknown_name`, `cc_decl_init_sibling_var`, 2026-09-21).
 */
function initializerFindings(ctx: CheckContext, unparsed: ReadonlySet<string>, out: DiagnosticItem[]): void {
  for (const { decl, scope } of forEachDecl(ctx.parseResult, ctx.project)) {
    // an AGGREGATE initializer is a different shape with its own element list, and `struct-init`/`array-init`
    // own it — this is the plain-expression case only
    if (decl.init === undefined || decl.init.kind === "aggregate_init") continue
    for (const ref of unresolvedInExprs([decl.init], scope)) {
      if (unparsed.has(ref.name.toLowerCase())) continue
      // …but a `__` name is the compilers' own namespace, and one they do not know never reaches name resolution
      // here at all — the PARSER refuses it leading an initializer (`parse/initializer` `refuseMalformedInit`).
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
