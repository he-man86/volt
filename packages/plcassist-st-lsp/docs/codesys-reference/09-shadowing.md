# 09 — Shadowing Rules

> **Source:** https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_shadowing_rules.html
> **Retrieved:** 2026-05-26
> **CODESYS version:** V3.5.22.0

## Summary

CODESYS allows the same identifier to name different elements (a POU and a variable, a method and a local). The compiler doesn't error on these collisions — it picks one according to a fixed search order, and the others are **shadowed**. This is a primary source of "code parses but does the wrong thing" bugs. The full search order below is the exact algorithm the compiler uses.

## Critical rule

> The compiler does not report any errors or warnings if the same identifier is used for different elements. Instead, the compiler searches the code in a specific order for the declaration of the identifier.

There are **no silent diagnostics**. If the AI generates code where two elements share a name, CODESYS will compile cleanly and call whichever the search order finds first. Whether that's what the AI intended is the AI's problem.

## Negative example (from the CODESYS page)

```st
FUNCTION YYY : INT
END_FUNCTION

FUNCTION_BLOCK XXX
END_FUNCTION_BLOCK

PROGRAM PLC_PRG
VAR
  YYY : XXX;   (* local FB instance named YYY *)
END_VAR

YYY();          (* ambiguous: function YYY or method call on instance YYY? *)
END_PROGRAM
```

The compiler will resolve `YYY()` to the local instance call (local wins over global POU name), but a reader could easily think it's the function.

## Search order in the application

When the compiler encounters a single identifier (not a qualified path like `foo.bar`), it walks this list **top to bottom** and uses the first match found:

1. Local variables
2. Local variables of a method
3. Local variables in the function block / program / function, and any base function blocks
4. Local methods of the POU
5. Global variables in the application, if the variable list does **not** carry `qualified_only`
6. Global variables in a parent application, same condition
7. Global variables in referenced libraries, if neither the library nor the GVL requires qualified access
8. POU or type names from the application (GVL names, FB names, etc.)
9. POU or type names from a parent application
10. POU or type names from a library
11. Namespaces of locally referenced libraries and libraries published by libraries
12. Global variables in the POUs view, unless `qualified_only`
13. POU or type names from the POUs view
14. Libraries from POUs

**Implication for the LSP**: this exactly mirrors the parent-chain walk in `resolver.ts:41`'s `lookup()` function — local scope first, then walk outward. Where we differ from CODESYS: we don't currently model library symbol tables (steps 7, 10, 11, 14). That's a known blind spot.

## Search order in a library

When the same code lives inside a library, the rules shift slightly:

1. Local variables
2. Local variables of a method
3. Local variables in the FB/program/function and base FBs
4. Local methods of the POU
5. Global variables in the local library, if no `qualified_only`
6. Global variables in referenced libraries, if no qualified access required
7. POU or type names from the local library
8. POU or type names from a referenced library
9. Namespaces of locally-referred libraries and libraries published by them

## Qualified access (the escape hatches)

When a single identifier is ambiguous or shadowed and the user wants the *other* meaning, CODESYS provides:

| Form | What it forces |
|---|---|
| `.identifier` | Global namespace lookup (skips local) |
| `gvl_name.var` | Variable in that specific GVL |
| `library.symbol` | Symbol in that referenced library |
| `lib0.lib1.symbol` | Transitively referenced library symbol |
| `THIS^.field` | The FB's own field, even if a local of the same name exists in a method |
| `__POOL.POU()` | POU in the POUs view, not in the Devices view |
| `SUPER^.method()` | Inherited method, even if overridden locally |

CODESYS also reports **`Ambiguous use of the name XXX`** as an error when two global lists both have a non-qualified name. That's one of the few cases where shadowing surfaces as a compile error.

## Member access (`yy.component`)

The single-identifier search order **does not apply** to qualified paths. For `yy.component`:

- If `yy` is a STRUCT or UNION variable: `component` is searched in the FB's local vars → base FB locals → methods → base methods.
- If `yy` is a GVL or PROGRAM name: `component` is searched in that list only.
- If `yy` is a library namespace: `component` is searched in that library using the library search order above.

Access permissions are checked **after** name resolution — a method found by lookup may still be rejected as `private`/inaccessible.

## Defensive recommendations from CODESYS

To avoid relying on the search order:
- Apply naming conventions (Hungarian prefixes from [08-identifiers.md](./08-identifiers.md))
- Set `qualified_only` on enums and GVLs (forces fully-qualified access) — see [07-pragmas.md](./07-pragmas.md)
- Use qualified libraries
- Prepend `__POOL` when calling a POU from the POUs view to avoid Devices-view shadows
- Use `THIS^.x` consistently for FB fields inside methods
- CODESYS static code analysis (a separate feature) **can** be configured to flag duplicate name use as an error

## Notes for tooling

**Mechanically enforceable in the LSP:**
- The search order is already implemented in `resolver.ts:41` (parent-chain walk, innermost shadow wins) for the scopes we model: local POU, method, project. Matches steps 1–4 of the CODESYS list.
- **Information-level diagnostic candidate**: when a declaration is added that shadows an outer-scope name, emit an `Information` diagnostic noting the shadow. Legal but error-prone — matches Stage 4 of the plan.
- **Cross-reference for hover**: when hovering a name that's shadowed elsewhere, mention the other declarations.

**Not enforceable (library-blind):**
- Steps 7, 10, 11, 14 — we don't index referenced libraries
- The "Ambiguous use" error — requires global GVL deconfliction, possible once GVLs are indexed
- `__POOL` / `SUPER^` semantics — these are syntactically distinct paths; not a search-order concern

**Stage 4 of the plan deep-dives this into `src/reference/shadowing.ts`.**
