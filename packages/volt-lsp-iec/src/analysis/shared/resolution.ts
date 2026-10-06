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
import { compilerTypeText, walkExpr, type Expr, type Identifier, type MemberExpr, type Span, type TypeExpr } from "../../frontend/syntax/index.js"
import { gvlBlockOf, hasUnresolvedBase, isLibrarySymbol, lookupLocal, lookupMember, resolveGvlMember, rootOf, type Scope, type Symbol } from "../../frontend/symbols/index.js"
import { ANY_FAMILIES, builtinName, GENERIC_PARAMETER_TYPES, inferExprType, isDialectType, isSfcStepBase, resolveBareName, sfcStepTypeScope } from "../../frontend/types/index.js"


export interface BareRef {
  name: string
  span: Span
}

/**
 * Visit only the identifiers that are BARE references (the root of a chain) — NOT member names (`.b` in
 * `a.b`) nor named-argument params (`p` in `f(p := v)`), both of which are `IdentExpr` in the tree but
 * resolve against a callee/type, not the local scope. Mirrors `ast-walk`'s traversal minus those — and minus a STEP of an SFC
 * chart read with a member (`S_Boot.x`), which no declaration names (`types/infer/sfc-step`).
 */
function collectBareRefs(root: Expr, emit: (ref: BareRef) => void, isStep: (access: MemberExpr) => boolean): void {
  const collect = (e: Expr): void => {
    switch (e.kind) {
      case "ident_expr":
        emit(e)
        return
      case "literal":
        return
      case "member":
        if (e.base.kind === "ident_expr" && isStep(e)) return
        collect(e.base) // skip e.member (a member name, not a bare ref)
        return
      case "call":
        collect(e.callee)
        for (const a of e.args) if (a.value !== undefined) collect(a.value) // skip a.param
        return
      case "index":
        collect(e.base)
        for (const i of e.indices) collect(i)
        return
      case "deref":
        collect(e.base)
        return
      case "binary":
        collect(e.left)
        collect(e.right)
        return
      case "unary":
        collect(e.operand)
        return
      case "paren":
        collect(e.inner)
        return
      case "assign_expr":
        collect(e.target)
        collect(e.value)
        return
    }
  }
  collect(root)
}

/** Whether the bare name `name`, written in `scope`, names anything — the search order's answer (`types/names`
 *  `resolveBareName`, rule Y23), which this layer only words. An AMBIGUOUS name names nothing: a member two enums declare
 *  is "Identifier not defined" beside "Ambiguous use of name" on both vendors (rule EN3, `enum_same_member_*`). */
export function nameResolves(name: string, scope: Scope): boolean {
  const kind = resolveBareName(scope, name).kind
  return kind !== "none" && kind !== "ambiguous"
}

/** The bare identifier references in `exprs` that resolve in NO reachable scope. */
export function unresolvedInExprs(exprs: Iterable<Expr>, scope: Scope): BareRef[] {
  const out: BareRef[] = []
  const project = rootOf(scope)
  const isStep = (access: MemberExpr): boolean => isSfcStepBase(access, scope, project)
  for (const e of exprs) {
    collectBareRefs(
      e,
      (ref) => {
        if (!nameResolves(ref.name, scope)) out.push(ref)
      },
      isStep,
    )
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
  // `P.S_Boot` read with a member is a STEP of P's chart (`types/infer/sfc-step`), no unknown member of P: met before it
  // (the walk is pre-order) and passed over
  const steps = new Set<Expr>()
  for (const e of exprs) {
    walkExpr(e, (x) => {
      if (x.kind !== "member" || steps.has(x)) return
      if (isSfcStepBase(x, scope, project)) {
        steps.add(x.base)
        if (lookupMember(sfcStepTypeScope(), x.member.name) === undefined) out.push({ member: x.member.name, typeName: "SFCStepType", span: x.member.span })
        return
      }
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
  // a REFERENCE TO a type is read through: `rf.nope` is no component of the FB (rule M3, `mem_unknown_member_through_reference`)
  const written = inferExprType(m.base, scope, project)
  const t = written.kind === "reference" ? written.target : written
  // …and a STRUCT type's, an INTERFACE's or a namespace's NAME as the base (rule DT8's `StaticType`; a "struct" before it):
  // `Dut_s.nope` is no component of 'Dut_s', named as declared, as it was (step 4.7.4 review). A GVL's is `gvlBlockOf`'s
  // above; a FUNCTION's or METHOD's name has no members.
  if (t.kind === "static") {
    if (t.denotes !== "struct" && t.denotes !== "interface" && t.denotes !== "namespace") return undefined
  } else if (t.kind !== "struct" && t.kind !== "function_block" && t.kind !== "enum" && t.kind !== "interface") return undefined
  if (t.scope === undefined) return undefined
  // an ANY / ANY_* input is the compiler's __SYSTEM.AnyType (`types/system`): its known members are typed, but an unknown
  // one is unrecorded — the vendor's sentence may name AnyType rather than the group — so it is not refused (step 4a review)
  if (t.kind === "struct" && GENERIC_PARAMETER_TYPES.has(t.name.toUpperCase())) return undefined
  const typeSym = lookupLocal(project, t.name)[0]
  if (typeSym !== undefined && isLibrarySymbol(typeSym)) return undefined // library type → signatures lossy, skip
  if (hasUnresolvedBase(t.scope)) return undefined // an unresolved EXTENDS base could hide the member
  if (lookupMember(t.scope, m.member.name) !== undefined) return undefined
  // an INTERFACE's member set is `<ITF>__Union` in the vendor's words: "'Nope' is no component of
  // 'ITF_LANG_…__Union'" (rule M1, `mem_unknown_method_of_interface`, both vendors 2026-10-02)
  return { member: m.member.name, typeName: t.kind === "interface" ? `${t.name}__Union` : t.name, span: m.member.span }
}

/**
 * The bases of member accesses `p.x` in `exprs` that are a POINTER, read without its `^` — "'p' is no structured
 * variable" on both vendors, the access then a hole (rule M3, `mem_pointer_member_without_deref`, 2026-10-02). A
 * pointer has no members of its own; `p^.x` is the target's.
 */
export function pointerMemberBases(exprs: Iterable<Expr>, scope: Scope, project: Scope): Expr[] {
  const out: Expr[] = []
  for (const e of exprs)
    walkExpr(e, (x) => {
      // …but not a STEP's name: D40 bets a variable of a type with no members of its own, a pointer's included, the step of
      // its POU's chart when read with a member in an SFC POU (`types/infer/sfc-step`) — as every other check then reads it
      if (x.kind === "member" && inferExprType(x.base, scope, project).kind === "pointer" && !isSfcStepBase(x, scope, project)) out.push(x.base)
    })
  return out
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
 * <p>Deliberately narrow where it is unmeasured: a bare named type, and a qualified one whose first qualifier names
 * nothing (`unknownQualifiedTypeName`) — a wrapper around an unknown name (`ARRAY OF X`, `POINTER TO X`) is a different
 * shape nobody has recorded. A name some symbol DOES carry is left alone even when that symbol is no type: that is a different
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
  if (t?.kind !== "named_type" || t.subrange !== undefined) return undefined
  if ((t.qualifiers?.length ?? 0) > 0) return unknownQualifiedTypeName(project, t.qualifiers!, t.name)
  const name = t.name.text
  const upper = name.toUpperCase()
  // a name the compiler provides — a system operator, a built-in, a type, an implicit — resolves here as it does in the
  // search order (`builtinName`): bare TYPE_CLASS is a type CODESYS builds clean (conformance `op_sys_type_class_bare`),
  // so the two verdicts about one name may not differ
  if (builtinName(name, project.dialect) !== undefined || ANY_FAMILIES.has(upper) || BUILTIN_NAMED_TYPES.has(upper)) return undefined
  if (lookupLocal(project, name).length > 0) return undefined
  return name
}

/**
 * `Q.….T` whose FIRST qualifier names nothing at all — no namespace, no unit, no symbol of any kind: "Unknown type:
 * 'NoSuchLib.T'", both vendors (`decl_type_unknown_qualified`, 2026-10-01), the written name as the message's. The same
 * bet as the bare verdict: a referenced library's namespace is bound from its manifest (`library-namespaces`), so a
 * qualifier nothing carries is no library the project references.
 *
 * <p>Only the first qualifier is judged. A namespace the project HAS is left alone whatever it holds (rule LB2): it reaches
 * the elements of a dependency it publishes — corpus `L_IE1P.L_IE1P_SeverityLevel`, 51 references in two projects that
 * build — and not those of one it does not (`DED.IO_SYSTEM_TYPE` is "Unknown type", `lib_ns_direct_dependency_only`), and
 * the manifest does not say which. The compiler's own `__SYSTEM` namespace is a `__` name, no symbol's.</p>
 *
 * <p>KNOWN DIVERGENCE, niche: accepted loss (0 occurrences in the corpora — every `Library Manager/` folder of the six
 * carries its `.library` manifest, `(unresolved)/` aside, whose interface libraries no qualifier names by folder): when
 * the bridge skips a reference's manifest (`CodesysObjectModel.Libraries.cs` logs "library ref … skipped — no .library
 * item will materialize") while its units still materialize, the bet fails, and a `Ns.T` CODESYS builds is "Unknown
 * type" here, blaming the code rather than the missing manifest.</p>
 */
function unknownQualifiedTypeName(project: Scope, qualifiers: readonly Identifier[], name: Identifier): string | undefined {
  const first = qualifiers[0]!.text
  if (first.startsWith("__") || lookupLocal(project, first).length > 0) return undefined
  return [...qualifiers, name].map((q) => q.text).join(".")
}
