/**
 * Shared bare-identifier resolution (analysis/). The oracle behind the ST `unresolved-identifier` check, the `inheritance`
 * check's base-name test, and the network-text `network-undeclared-identifier` check — which is why it is not a helper
 * inside one check group (it was `checks/names/_identifier-resolution.ts`, imported across groups; the layering lint now
 * refuses that). The ST and network-text checks resolve alike: network-text operands are ST `Expr` trees, so a graphical body resolves
 * its identifiers by exactly the same rules as a textual one (against a network scope that layers the network's
 * `VAR_TEMP` wires over the POU scope). Keeping the rules in one place is what makes the two checks agree by
 * construction — a name ST resolves can never be one the network-text check flags, and vice-versa.
 *
 * WHAT A BARE NAME NAMES IS NOT DECIDED HERE: it is the search order's question, answered once by the front-end
 * (`types/names` `resolveBareName`, rule Y23 — the compiler's own names, the scopes outward, the project's level in
 * CODESYS's order, device instances, library namespaces, bare enum members). This layer only says what follows when it
 * names nothing. A LIBRARY'S element — Standard's LEN or TON included — resolves through the scope, from its
 * materialized declaration, and nowhere else: in a project that does not reference its library it is the unknown name
 * CODESYS says it is.
 */
import { compilerTypeText, walkExpr, type Expr, type MemberExpr, type Span, type TypeExpr } from "../frontend/syntax/index.js"
import { gvlBlockOf, hasUnresolvedBase, isLibrarySymbol, lookupLocal, lookupMember, resolveGvlMember, type Scope, type Symbol } from "../frontend/symbols/index.js"
import { ANY_FAMILIES, builtinName, inferExprType, isDialectType, resolveBareName } from "../frontend/types/index.js"


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

/** Whether the bare name `name`, written in `scope`, names anything — the search order's answer (`types/names`
 *  `resolveBareName`, rule Y23), which this layer only words. */
export function nameResolves(name: string, scope: Scope): boolean {
  return resolveBareName(scope, name).kind !== "none"
}

/** The bare identifier references in `exprs` that resolve in NO reachable scope. */
export function unresolvedInExprs(exprs: Iterable<Expr>, scope: Scope): BareRef[] {
  const out: BareRef[] = []
  for (const e of exprs) {
    collectBareRefs(e, (ref) => {
      if (!nameResolves(ref.name, scope)) out.push(ref)
    })
  }
  return out
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
  // `GVL.v` — a variable of THAT list (rule Y9): one it does not declare is "'v' is no component of 'GVL'" on both vendors
  // (`sym_gvl_unknown_member`). A library's list is skipped as a library type is: its declarations may be partial.
  const list = gvlBlockOf(m.base, scope, project)
  if (list !== undefined)
    return isLibrarySymbol(list) || resolveGvlMember(m, scope, project) !== undefined
      ? undefined
      : { member: m.member.name, typeName: list.name, span: m.member.span }
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
  if (isDialectType(name, project.dialect)) return undefined
  // …unless the PROJECT declares it. `TYPE LDATE : ULINT; END_TYPE` is exactly the shim a TwinCAT project
  // porting CODESYS code writes, and `resolveNamedType` resolves it — so without this the two disagree about
  // the same name, and the one that speaks is the one that is wrong.
  if (lookupLocal(project, name).length > 0) return undefined
  return compilerTypeText(t)
}

/**
 * The name a declared type spells that NOTHING DECLARES — "Unknown type: '<name>'" (C0077) — or `undefined` when the LSP
 * has no standing to say so.
 *
 * <p>Measured on CODESYS SP21 and identical on TwinCAT (2026-09-30, conformance `objects/written-as-sent.ts`): an FB or
 * a DUT whose object's text declares nothing — a never-closed `(*`, an empty or a prose text — leaves every
 * declaration of its name with this error. It is the same bet `nameResolves` makes for an identifier one function up:
 * a library's element resolves through the scope, from its materialized declaration, so a BARE name that nothing in
 * the project, no referenced library and no compiler built-in declares is the unknown name CODESYS says it is.</p>
 *
 * <p>Deliberately narrow where it is unmeasured: only a bare named type — a namespace-qualified name (`Lib.T`) is the
 * library floor, and a wrapper around an unknown name (`ARRAY OF X`, `POINTER TO X`) is a different shape nobody has
 * recorded. A name some symbol DOES carry is left alone even when that symbol is no type: that is a different
 * error, not this one. A CODESYS-only elementary type on TwinCAT is `dialectMissingType`'s.</p>
 *
 * <p>CODESYS ONLY, and measured so: TwinCAT answers the same message for the same shapes, but its library
 * materialization (`References/`) does not carry every type its compiler knows — the External Types (`HRESULT`,
 * `PVOID`, `OTCID`) and Tc2_System's `ST_LibVersion` are declared in no file (corpus `twincat-project14`, whose own
 * library GVLs declare globals of them). There, "nothing declares it" is not something the LSP can know.</p>
 */
/**
 * The compilers' own NAMED types that are no elementary type and no library's — `docs/codesys-reference/06-data-types.md`,
 * read section by section: `ANY` (its `ANY_<type>` families are `ANY_FAMILIES`) and `VERSION`, the project-information
 * struct both vendors build without any library (conformance `type_codesys_version`). `BIT` and `__UXINT`/`__XINT`/
 * `__XWORD` are elementary; `__VECTOR`, `POINTER TO`, `REFERENCE TO` and `ARRAY OF` are no bare name.
 */
const BUILTIN_NAMED_TYPES: ReadonlySet<string> = new Set(["ANY", "VERSION"])

export function unknownTypeName(project: Scope, t: TypeExpr | undefined): string | undefined {
  const dialect = dialectMissingType(project, t)
  if (dialect !== undefined) return dialect
  if (project.dialect !== "codesys") return undefined
  if (t?.kind !== "named_type" || t.subrange !== undefined || (t.qualifiers?.length ?? 0) > 0) return undefined
  const name = t.name.text
  const upper = name.toUpperCase()
  // a name the compiler provides — a system operator, a built-in, a type, an implicit — resolves here as it does in the
  // search order (`builtinName`): bare TYPE_CLASS is a type CODESYS builds clean (conformance `op_sys_type_class_bare`),
  // so the two verdicts about one name may not differ
  if (builtinName(name, project.dialect) !== undefined || ANY_FAMILIES.has(upper) || BUILTIN_NAMED_TYPES.has(upper)) return undefined
  if (lookupLocal(project, name).length > 0) return undefined
  return name
}
