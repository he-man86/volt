/**
 * Shared bare-identifier resolution (names/). The oracle behind BOTH the ST `unresolved-identifier` check
 * and the VG `vg-undeclared-identifier` check: VG operands are ST `Expr` trees, so a graphical body resolves
 * its identifiers by exactly the same rules as a textual one (against a network scope that layers `LET`
 * wires over the POU scope). Keeping the rules in one place is what makes the two checks agree by
 * construction — a name ST resolves can never be one VG flags, and vice-versa.
 *
 * Zero-FP is the whole game. A name resolves (is NOT flagged) when it is any of: a `__`-system operator, a
 * conversion call (`<T>_TO_<U>` / `TO_<U>`), a compiler-provided implicit (`THIS`/`SUPER`/`IoConfig_Globals`/
 * `TYPE_CLASS`), a built-in in the reference catalog, a referenced-library namespace or device-tree instance,
 * a bare-accessible enum member, or anything in the given scope (parent chain + EXTENDS bases).
 */
import type { Expr, Span } from "../../../syntax/index.js"
import { lookupReference } from "../../../reference/index.js"
import { lookup, resolveBareEnumMember, type Scope } from "../../../symbols/index.js"
import type { WorkspaceRefs } from "../../config.js"

/** A conversion-operator call shape: `INT_TO_REAL`, `WORD_TO_BYTE`, `TO_STRING`. Not a scope symbol. */
const CONVERSION_RE = /^(?:[A-Za-z][A-Za-z0-9]*_TO_[A-Za-z]|TO_[A-Za-z])/i

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
export function collectBareRefs(e: Expr, emit: (ref: BareRef) => void): void {
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

/** Every resolution avenue for a bare name; true = valid (skip), false = unresolved (flag). */
export function nameResolves(name: string, scope: Scope, project: Scope, references: WorkspaceRefs): boolean {
  const lower = name.toLowerCase()
  if (name.startsWith("__")) return true // reserved system operator (`__NEW`, `__ISVALIDREF`, …)
  if (CONVERSION_RE.test(name)) return true // conversion call — an implicit token, not a symbol
  if (COMPILER_PROVIDED_IMPLICITS.has(lower)) return true
  if (lookupReference(name) !== undefined) return true // built-in operator / std function / std FB / type
  if (references.libraryNamespaces.has(lower)) return true // referenced-library namespace root
  if (references.deviceInstances.has(lower)) return true // device-tree instance
  if (resolveBareEnumMember(project, name) !== undefined) return true // non-qualified_only enum member
  if (lookup(scope, name) !== undefined) return true // parent chain + EXTENDS bases
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
