/**
 * duplicate-declaration (D.2 · names/). Same identifier declared twice in one scope → both vendors
 * error "A local variable named '<n>' is already defined in '<POU>'". Scoped to THIS file's unit
 * scopes only — cross-file name reuse (two GVLs, a `Delete` FB + `Delete` function) is legal and
 * namespace-resolved, so the project scope is never walked. `qualified_only` GVL vars are excluded
 * (they live in their own namespace, so same-named vars across GVLs don't collide).
 *
 * (The identifier-SHAPE lints — reserved-keyword / double-underscore / consecutive-underscore — are
 * opt-in style lints, off by default: the compilers parse-cascade on them, so a single clean message
 * would never match the IDE's error spray.)
 */
import { allUnits, type VarDecl } from "../../../frontend/syntax/index.js"
import { scopeForUnit, type Scope, type Symbol } from "../../../frontend/symbols/index.js"
import type { CheckContext } from "../../pipeline/context.js"
import { SOURCE, withFixes, type DiagnosticItem, type Fix } from "../../shared/diagnostic-item.js"
import { fixOf, removeConstruct, sameSection, sectionOf } from "../../shared/fixes.js"

export function checkDuplicateDeclarations(ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const unit of allUnits(ctx.parseResult.units)) {
    // A GLOBAL LIST's variables live in the project scope, flat with every other list's — so its duplicates are the
    // names the binder bound from THIS list (a VAR_ACCESS section binds nothing, a refused-AT declaration is dropped —
    // `ingestGlobalVarList`, one rule), named as the binder names the list (its `gvl_block` symbol, `gvlName`), which its
    // text never names (`dupn_gvl_variable_twice`, both vendors 2026-10-06: "… already defined in 'GVL_…'").
    if (unit.kind === "global_var_list") {
      const decls = new Set<unknown>(unit.varSections.flatMap((section) => section.decls))
      let list: string | undefined
      const bound: Symbol[][] = []
      for (const [, symbols] of ctx.project.symbols) {
        list ??= symbols.find((s) => s.kind === "gvl_block" && s.ast === unit)?.name
        const own = symbols.filter((s) => s.kind === "gvl_var" && decls.has(s.ast))
        if (own.length > 1) bound.push(own)
      }
      if (list === undefined) continue
      for (const own of bound)
        for (const sym of own.slice(1))
          out.push({ severity: "error", span: sym.span, source: SOURCE, code: "duplicate-declaration", message: ctx.messages.duplicateDeclaration(sym.name, list) })
      continue
    }
    const scope = scopeForUnit(ctx.project, unit)
    if (scope === undefined) continue
    walkScopeForDuplicates(scope, ctx, out)
    // a FUNCTION's or METHOD's name IS its result variable (rule Y20): a local or VAR_INPUT of that name declares it a
    // second time — "A local variable named 'F' is already defined in 'F'" on both vendors
    // (`sym_function_local_named_as_function`, `sym_function_input_named_as_function`, `sym_method_local_named_as_method`,
    // `sym_method_input_named_as_method`). A METHOD with no `: <type>` has no result variable, and an input of its name is
    // an input: pro2193's `METHOD PUBLIC Rollover` takes `rollover := 5` and builds
    if (unit.kind === "function" || (unit.kind === "method" && unit.returnType !== undefined))
      for (const sym of scope.symbols.get(unit.name.text.toLowerCase()) ?? [])
        out.push({
          severity: "error",
          span: sym.span,
          source: SOURCE,
          code: "duplicate-declaration",
          message: ctx.messages.duplicateDeclaration(sym.name, scope.name),
        })
  }
}

function walkScopeForDuplicates(scope: Scope, ctx: CheckContext, out: DiagnosticItem[]): void {
  for (const [, symbols] of scope.symbols) {
    const bareName: Symbol[] = symbols.filter((s) => !s.qualifiedOnly)
    // a METHOD and a VARIABLE of one name do not collide: both vendors build it and warn "Ambiguous use of name" where the
    // name is written bare (`dupn_method_named_as_variable`, analysis-conformance 3.5) — ambiguous-global's to say. Every
    // other pair collides (a METHOD beside an ACTION or a PROPERTY of its name stays a duplicate). Each declaration is said
    // once, against the first earlier one it collides with.
    for (let i = 1; i < bareName.length; i++) {
      const sym = bareName[i]!
      const prior = bareName.slice(0, i).find((s) => !methodBesideVariable(s, sym))
      if (prior === undefined) continue
      // Two methods sharing a name is an unmarked overload (C0582) — a distinct error from a duplicate var, and
      // one Volt can't push at all (the bridge's CreateChild rejects the second child). Use its own wording.
      const isMethod = sym.kind === "method" && prior.kind === "method"
      out.push(
        withFixes(
          {
            severity: "error",
            span: sym.span,
            source: SOURCE,
            code: isMethod ? "duplicate-method" : "duplicate-declaration",
            message: isMethod ? ctx.messages.duplicateMethod(sym.name) : ctx.messages.duplicateDeclaration(sym.name, scope.name),
          },
          isMethod ? [] : removeOneFixes(ctx, prior, sym),
        ),
      )
    }
  }
  // A unit's scope is walked for that unit — a METHOD's, an ACTION's and a PROPERTY's are units of their own, so the FB's
  // walk does not descend into them (it reported a method's duplicate a second time, `sym_duplicate_method_param_and_local`).
  // A property's accessor scopes belong to no unit: the property's walk takes them.
  if (scope.kind === "accessor")
    for (const child of scope.children) if (child.kind === "accessor") walkScopeForDuplicates(child, ctx, out)
}

/**
 * C0142's fixes (design.md §4 F10): "Remove the second declaration of '<n>'" and "Remove the first …" — each its whole
 * declaration (and its line), so the other survives (`qf_c0142_remove_second_same`, `_first_same`, `_second_differ`,
 * `_first_differ`). Which survives decides the variable's type, initial value and section, so `preferred` — on keeping
 * the first — only where the two are declared ALIKE in sections of one kind and qualifiers (§3: one meaning). Only two variables of this document, each declared alone (a
 * `a, b : INT` declaration would take its other names with it).
 */
function removeOneFixes(ctx: CheckContext, first: Symbol, second: Symbol): Fix[] {
  const [a, b] = [ownDecl(ctx, first), ownDecl(ctx, second)]
  if (a === undefined || b === undefined) return []
  // …and in the same kind of section: an input and a local of one name, or a constant and a variable, are not the same
  // variable whichever is removed
  const sections = allUnits(ctx.parseResult.units).flatMap((u) => ("varSections" in u ? u.varSections : []))
  const [sa, sb] = [sectionOf(sections, a), sectionOf(sections, b)]
  const alike = declaredAs(ctx, a) === declaredAs(ctx, b) && sa !== undefined && sb !== undefined && sameSection(sa, sb)
  return [
    fixOf(`Remove the second declaration of '${second.name}'`, [removeConstruct(ctx.source, b.span.start, b.span.end)], alike),
    fixOf(`Remove the first declaration of '${first.name}'`, [removeConstruct(ctx.source, a.span.start, a.span.end)]),
  ]
}

/** A variable's declaration in this document, when it declares that one name alone. */
function ownDecl(ctx: CheckContext, sym: Symbol): VarDecl | undefined {
  const d = sym.ast as VarDecl
  return (sym.kind === "var" || sym.kind === "method_param") && sym.uri === ctx.uri && d.kind === "var_decl" && d.names.length === 1 ? d : undefined
}

/** What a declaration declares after its name — its type and initial value as written, blanks aside. */
const declaredAs = (ctx: CheckContext, d: VarDecl): string => ctx.source.slice(d.type.span.start, d.span.end).replace(/\s+/g, "").toUpperCase()

/** A METHOD and a variable of the FB (`var`) — the one pair of one name both vendors build (`dupn_method_named_as_variable`). */
function methodBesideVariable(a: Symbol, b: Symbol): boolean {
  return (a.kind === "method" && b.kind === "var") || (a.kind === "var" && b.kind === "method")
}
