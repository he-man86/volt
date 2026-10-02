/**
 * WHICH FUNCTION BLOCKS THE VENDOR COMPILES — the FBs REACHED from what is compiled anyway, and every base of one. The
 * roots are the PROGRAMs, the FUNCTIONs and the global variable lists; from a compiled scope (its methods, actions and
 * accessors included) every declaration's type reaches the FB it names — an instance, an `ARRAY … OF` one, a `POINTER TO`
 * or a `REFERENCE TO` one — and a STRUCT it names reaches what its fields name.
 *
 * Measured on CODESYS (`fixtures/names/inheritance.ts`, frontend-conformance 3.2, 2026-10-02), each with an override that
 * differs from its base's:
 *   - nothing instances the FB → it builds (`inh_override_uninstanced`), and so does an FB nothing instances whose
 *     method differs from its interface's (`inh_interface_method_signature_mismatch_uninstanced`) or that leaves out the
 *     method its derived interface inherits (`inh_implements_derived_missing_base_method_uninstanced`);
 *   - instanced only inside an FB that nothing instances → it builds (`inh_override_instanced_in_uninstanced_fb`): the
 *     instance is reached only if its holder is, so the set is a REACH, not "some declaration instances it";
 *   - reached only through a `POINTER TO` / `REFERENCE TO` it (each also calls the method through it) → the override is
 *     refused (`inh_override_pointer_only`, `_reference_only`), and so is one created only by `__NEW` (recorded, the
 *     fixture dropped for the application-setting error beside it).
 * pro2193 agrees: its `Cylinder_52Valve_InvertedFB` and `RejectStation_WithCylinderFB` differ from their base and
 * interface, nothing reaches them, and the project builds.
 *
 * UNMEASURED, and answered in the direction that keeps a check SPEAKING: a FUNCTION or a PROGRAM nothing calls is a root
 * (no fixture leaves one uncalled); a `__NEW(D)` whose result is held only as a `POINTER TO` a base of D does not reach D.
 *
 * The checks of an FB's own declaration against its bases' and interfaces' (`method-signature`,
 * `interface-implementation`) answer only for an FB in this set. Dead-code suppression (`reachability.ts`) cannot answer
 * this: it keeps an FB that implements a referenced interface live, which is the safe direction for hiding diagnostics
 * and the wrong one for raising them.
 */
import { basesOf, memoByProject, type Scope, type Symbol } from "../frontend/symbols/index.js"
import type { TypeExpr } from "../frontend/syntax/index.js"

/** The declarations whose type a compiled scope holds — a variable, a GVL's, a parameter, a STRUCT field. An FB
 *  symbol's or a PROPERTY's typeExpr holds nothing. */
const HOLDING: ReadonlySet<Symbol["kind"]> = new Set(["var", "gvl_var", "method_param", "struct_field"])

/** The top-level FB scopes the vendor compiles — reached from a PROGRAM, a FUNCTION or a GVL, or a base of one that is. */
export const compiledFbs = memoByProject((project: Scope): ReadonlySet<Scope> => {
  const fbs = new Map<string, Scope[]>()
  const structs = new Map<string, Scope[]>()
  const roots: Scope[] = []
  const index = (into: Map<string, Scope[]>, s: Scope): void => {
    const key = s.name.toLowerCase()
    into.set(key, [...(into.get(key) ?? []), s])
  }
  const walk = (container: Scope): void => {
    for (const c of container.children) {
      if (c.kind === "namespace") walk(c)
      else if (c.kind === "gvl") roots.push(c)
      else if (c.kind === "struct") index(structs, c)
      else if (c.kind === "pou") {
        const kind = unitKind(container, c)
        if (kind === "function_block") index(fbs, c)
        else if (kind === "program" || kind === "function") roots.push(c)
      }
    }
  }
  walk(project)
  const fbSet = new Set([...fbs.values()].flat())

  const out = new Set<Scope>()
  const seen = new Set<Scope>()
  const reach = (s: Scope): void => {
    if (seen.has(s)) return
    seen.add(s)
    if (fbSet.has(s)) {
      out.add(s)
      for (const b of basesOf(s)) reach(b)
    }
    holds(s, true)
  }
  /** Reach what `scope`'s declarations name — and, with `deep`, its child scopes' (methods, actions, accessors). */
  const holds = (scope: Scope, deep: boolean): void => {
    for (const syms of scope.symbols.values())
      for (const s of syms)
        if (s.typeExpr !== undefined && HOLDING.has(s.kind))
          for (const name of namedIn(s.typeExpr)) for (const t of [...(fbs.get(name) ?? []), ...(structs.get(name) ?? [])]) reach(t)
    if (deep) for (const c of scope.children) holds(c, true)
  }
  holds(project, false) // the global variable lists' variables live on the project scope itself
  for (const r of roots) reach(r)
  return out
})

/** The kind of the unit symbol `container` declares for the top-level scope `s`. */
function unitKind(container: Scope, s: Scope): Symbol["kind"] | undefined {
  return container.symbols.get(s.name.toLowerCase())?.find((x) => (x.ast as { span?: unknown } | undefined)?.span === s.span)?.kind
}

/** The type names a declaration's type reaches (lowercased, a qualified name's last part): its named type, an array's
 *  element's, a POINTER's or REFERENCE's target's. */
function namedIn(t: TypeExpr): string[] {
  switch (t.kind) {
    case "named_type":
      return [t.name.text.slice(t.name.text.lastIndexOf(".") + 1).toLowerCase()]
    case "array_type":
      return namedIn(t.element)
    case "pointer_type":
    case "reference_type":
      return namedIn(t.target)
    default:
      return []
  }
}
