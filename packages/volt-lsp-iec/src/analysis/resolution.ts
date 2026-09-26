/**
 * Shared bare-identifier resolution (analysis/). The oracle behind the ST `unresolved-identifier` check, the `inheritance`
 * check's base-name test, and the network-text `network-undeclared-identifier` check — which is why it is not a helper
 * inside one check group (it was `checks/names/_identifier-resolution.ts`, imported across groups; the layering lint now
 * refuses that). The ST and network-text checks resolve alike: network-text operands are ST `Expr` trees, so a graphical body resolves
 * its identifiers by exactly the same rules as a textual one (against a network scope that layers `LET`
 * wires over the POU scope). Keeping the rules in one place is what makes the two checks agree by
 * construction — a name ST resolves can never be one the network-text check flags, and vice-versa.
 *
 * Zero-FP is the whole game. A name resolves (is NOT flagged) when it is any of: a `__`-system operator, a
 * conversion call (`<T>_TO_<U>` / `TO_<U>`), a compiler-provided implicit (`THIS`/`SUPER`/`IoConfig_Globals`/
 * `TYPE_CLASS`), a compiler built-in in the reference catalog, a referenced-library namespace or device-tree instance,
 * a bare-accessible enum member, or anything in the given scope (parent chain + EXTENDS bases). A LIBRARY'S element —
 * Standard's LEN or TON included — resolves through the scope, from its materialized declaration, and nowhere else:
 * in a project that does not reference its library it is the unknown name CODESYS says it is.
 */
import { CODESYS_ONLY_KEYWORDS, renderTypeExpr, walkExpr, type Expr, type MemberExpr, type Span, type TypeExpr } from "../syntax/index.js"
import { CODESYS_ONLY_TYPES } from "../types/index.js"
import { lookupReference } from "../reference/index.js"
import { hasUnresolvedBase, isLibrarySymbol, lookup, lookupLocal, lookupMember, resolveBareEnumMember, type Scope, type Symbol } from "../symbols/index.js"
import { inferExprType, parseConversionName } from "../types/index.js"
import type { WorkspaceRefs } from "./config.js"


/**
 * Compiler-provided implicit references (lowercased) — never declared in project source, always valid:
 *   - `this` / `super` — the OOP self / base-class instance pointers (`THIS^`, `SUPER^.Method()`);
 *   - `ioconfig_globals` — the auto-generated I/O-mapping GVL (`IoConfig_Globals.<Device>.<pin>`);
 *   - `type_class` — the system enum used with `__VARINFO` / type reflection.
 */
const COMPILER_PROVIDED_IMPLICITS: ReadonlySet<string> = new Set([
  "this",
  "super",
  "ioconfig_globals",
  "type_class",
])

export interface BareRef {
  name: string
  span: Span
}

/**
 * Visit only the identifiers that are BARE references (the root of a chain) — NOT member names (`.b` in
 * `a.b`) nor named-argument params (`p` in `f(p := v)`), both of which are `IdentExpr` in the tree but
 * resolve against a callee/type, not the local scope. Mirrors `ast-walk`'s traversal minus those.
 */
function collectBareRefs(e: Expr, emit: (ref: BareRef) => void): void {
  switch (e.kind) {
    case "ident_expr":
      emit(e)
      return
    case "literal":
      return
    case "member":
      collectBareRefs(e.base, emit) // skip e.member (a member name, not a bare ref)
      return
    case "call":
      collectBareRefs(e.callee, emit)
      for (const a of e.args) if (a.value !== undefined) collectBareRefs(a.value, emit) // skip a.param
      return
    case "index":
      collectBareRefs(e.base, emit)
      for (const i of e.indices) collectBareRefs(i, emit)
      return
    case "deref":
      collectBareRefs(e.base, emit)
      return
    case "binary":
      collectBareRefs(e.left, emit)
      collectBareRefs(e.right, emit)
      return
    case "unary":
      collectBareRefs(e.operand, emit)
      return
    case "paren":
      collectBareRefs(e.inner, emit)
      return
    case "assign_expr":
      collectBareRefs(e.target, emit)
      collectBareRefs(e.value, emit)
      return
  }
}

/** Every resolution avenue for a bare name; true = valid (skip), false = unresolved (flag). A pure OR, so the
 *  order is a PERF choice, not semantics: cheap O(1) tests + the scope `lookup` (which resolves the vast majority
 *  of references — locals, params, project symbols) come BEFORE `resolveBareEnumMember`, whose per-call scan of
 *  every project enum is the check's hot spot. Reordering cut this check from ~88ms → ~2ms on a large project. */
export function nameResolves(name: string, scope: Scope, project: Scope, references: WorkspaceRefs): boolean {
  const lower = name.toLowerCase()
  // A reserved system operator (`__NEW`, `__ISVALIDREF`, …) — EXCEPT the four TwinCAT does not have, where
  // the name is an ordinary identifier that resolves nowhere, and TwinCAT says so: "Identifier
  // '__POSITION' not defined" (`syntax/tokens.ts` carries the measurement).
  if (name.startsWith("__"))
    return !(project.dialect === "twincat" && CODESYS_ONLY_KEYWORDS.has(name.toUpperCase()))
  // A conversion operator — an implicit token, not a symbol. Only a name CODESYS defines: this matched any `…_TO_…` shape,
  // so `TIME_OF_DAY_TO_UDINT` (not defined) and a project name like `GO_TO_START` were never flagged (consolidate A4).
  // …and a conversion is only as real as the TYPES it names: `DATE_TO_LDATE` is a CODESYS operator because LDATE is
  // a CODESYS type, and TwinCAT answers "Identifier 'DATE_TO_LDATE' not defined" (`types/elementary.ts`).
  const conversion = parseConversionName(name)
  if (conversion !== undefined) {
    // ASK THE PARSED CONVERSION, not the spelling. Splitting on `_TO_` misses the `TO_<Y>` shape entirely — it has
    // no leading underscore — so `TO_LDATE` stayed resolved on TwinCAT while `DATE_TO_LDATE` did not, which is the
    // same operator named two ways.
    const involved = [conversion.to.name, conversion.from?.name]
    return !(project.dialect === "twincat" && involved.some((n) => n !== undefined && CODESYS_ONLY_TYPES.has(n.toUpperCase())))
  }
  if (COMPILER_PROVIDED_IMPLICITS.has(lower)) return true
  if (lookupReference(name) !== undefined) return true // built-in operator / std function / std FB / type
  if (references.libraryNamespaces.has(lower)) return true // referenced-library namespace root
  if (references.deviceInstances.has(lower)) return true // device-tree instance
  if (lookup(scope, name) !== undefined) return true // parent chain + EXTENDS bases — resolves most references
  if (resolveBareEnumMember(project, name) !== undefined) return true // non-qualified_only enum member (last: scans enums)
  return false
}

/** The bare identifier references in `exprs` that resolve in NO reachable scope. */
export function unresolvedInExprs(
  exprs: Iterable<Expr>,
  scope: Scope,
  project: Scope,
  references: WorkspaceRefs,
): BareRef[] {
  const out: BareRef[] = []
  for (const e of exprs) {
    collectBareRefs(e, (ref) => {
      if (!nameResolves(ref.name, scope, project, references)) out.push(ref)
    })
  }
  return out
}

/**
 * The `__`-PREFIXED NAMES THIS DIALECT DOES NOT HAVE, in source order. `__` is the compilers' own namespace for
 * system operators, and one they do not know is not an undefined identifier — in a declaration's initializer it
 * is a PARSE refusal (`checks/declarations/system-initializer`), on both vendors.
 *
 * <p>It is exactly the unresolved names that begin with `__`, and that is not a coincidence to be tidied away:
 * `nameResolves` already answers TRUE for every system operator the dialect HAS, membership included, so a `__`
 * name reaching here has been ruled out by the same table that rules `__POSITION` in on CODESYS.</p>
 */
export function refusedSystemNames(exprs: Iterable<Expr>, scope: Scope, project: Scope, references: WorkspaceRefs): BareRef[] {
  return unresolvedInExprs(exprs, scope, project, references).filter((r) => r.name.startsWith("__"))
}

/**
 * CAN A CALL BIND THIS NAME? An FB's INPUTS, OUTPUTS and IN-OUTS can, and so can a PROPERTY; nothing else can.
 *
 * <p>One home because the question had two answers in one package. `checks/calls/call-arguments` asked
 * `lookupMember` UNFILTERED — so any member of the callee's scope counted, a plain `VAR loc : INT` included, and
 * `inst(loc := 5)` was accepted in silence. The network-text check beside it already restricted to the pin
 * sections and properties. Measured 2026-09-21 on both live IDEs (`cc_named_arg_non_input`): both answer
 * "'loc' is no input of 'FB_LANG_NAMED_ARG_HOLDER'", so the ST side was the one that was wrong.</p>
 *
 * <p>EN/ENO are deliberately NOT here: they are graphical-editor implicits with no ST call syntax, which is why
 * the network check seeds them and this does not. That difference is a language fact, not a second opinion.</p>
 */
export function bindableMember(scope: Scope, name: string): Symbol | undefined {
  const sym = lookupMember(scope, name)
  if (sym === undefined) return undefined
  return sym.kind === "property" || BINDABLE_SECTIONS.has(sym.varSection ?? "") ? sym : undefined
}

const BINDABLE_SECTIONS: ReadonlySet<string> = new Set(["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT"])

export interface MemberRef {
  member: string
  typeName: string
  span: Span
}

/**
 * Member accesses `base.member` in `exprs` where `member` is not declared on the base's type.
 *
 * Conservative to a fault (zero-FP is the whole game): a member is flagged ONLY when the base type resolves
 * to a PROJECT struct/FB/enum with a member scope, that type is NOT library-defined (library signatures may
 * be lossy), and its EXTENDS chain is fully resolved (else an inherited member could be hiding). Every other
 * base — unknown/unresolved, elementary, array/pointer, a namespace or type-name root (`CAA.HANDLE`,
 * `EnumType.Value` — the base is not a value, so it infers to UNKNOWN), a library type — is skipped. This is
 * why library-typed and namespace-qualified refs never false-positive: their base doesn't reach a checkable
 * project scope.
 */
export function unresolvedMembers(exprs: Iterable<Expr>, scope: Scope, project: Scope): MemberRef[] {
  const out: MemberRef[] = []
  for (const e of exprs) {
    walkExpr(e, (x) => {
      if (x.kind !== "member") return
      const ref = checkMember(x, scope, project)
      if (ref !== undefined) out.push(ref)
    })
  }
  return out
}

function checkMember(m: MemberExpr, scope: Scope, project: Scope): MemberRef | undefined {
  const t = inferExprType(m.base, scope, project)
  if (t.kind !== "struct" && t.kind !== "function_block" && t.kind !== "enum") return undefined
  if (t.scope === undefined) return undefined
  const typeSym = lookupLocal(project, t.name)[0]
  if (typeSym !== undefined && isLibrarySymbol(typeSym)) return undefined // library type → signatures lossy, skip
  if (hasUnresolvedBase(t.scope)) return undefined // an unresolved EXTENDS base could hide the member
  if (lookupMember(t.scope, m.member.name) !== undefined) return undefined
  return { member: m.member.name, typeName: t.name, span: m.member.span }
}

/**
 * The name this project's DIALECT cannot resolve, spelled as the declaration spelled it — or `undefined` when the
 * LSP has no standing to say the vendor is stuck.
 *
 * <p>This is the library floor drawn precisely. "The LSP cannot resolve it" means almost nothing on its own; the
 * usual cause is a library the LSP cannot see. What makes these names different is that they are ELEMENTARY, so no
 * library can supply them and the only thing that could is the project itself — which is why a `TYPE LDATE : ULINT;`
 * shim takes the name straight back off the list.</p>
 *
 * <p>It lives HERE, beside `nameResolves`, because two checks in different groups need the same verdict from
 * opposite ends — the DECLARATION says "Unknown type: 'LDATE'", and the assignment INTO that variable reports
 * its conversion with the unresolved name written out ("Cannot convert type 'Unknown type: 'DATE_TO_LDATE(v)''
 * to type 'LDATE'") — and a check may not import a sibling check. It is also the same fact `nameResolves`
 * already decides one line up for the CONVERSION named after such a type.</p>
 *
 * <p>Keyed on `project.dialect` rather than a passed-in vendor, so there is one answer per project.</p>
 */
export function dialectMissingType(project: Scope, t: TypeExpr | undefined): string | undefined {
  if (project.dialect !== "twincat") return undefined
  // an ARRAY OF or POINTER TO wrapper is a different shape and is left alone
  if (t?.kind !== "named_type") return undefined
  const name = t.name.text
  if (!CODESYS_ONLY_TYPES.has(name.toUpperCase())) return undefined
  // …unless the PROJECT declares it. `TYPE LDATE : ULINT; END_TYPE` is exactly the shim a TwinCAT project
  // porting CODESYS code writes, and `resolveNamedType` resolves it — so without this the two disagree about
  // the same name, and the one that speaks is the one that is wrong.
  if (lookupLocal(project, name).length > 0) return undefined
  return renderTypeExpr(t)
}
