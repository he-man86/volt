## Context

The analysis checks and the language services independently re-implement body iteration. Each check under `src/analysis/checks/**` opens with `for (const unit of ctx.parseResult.units) { const body = getBody(unit); const scope = findScopeForUnit(ctx.project, unit); const parsed = parseStatements(body); walk… }` (e.g. `assignment.ts:19-24`). `services/shared/resolve-at.ts:37` has the same loop as `stBodies`. The analysis `getBody` (`checks/_shared.ts:44`) returns a single POU body and returns `undefined` for `property`, so property accessor bodies are never checked; services' `unitBodies` (`syntax/bodies.ts:13`) does include accessor bodies. `signature-help.ts:30` resolves a `CallExpr` to its callee + params via `resolveMemberChain` + `varInputParams`; the call-argument check needs exactly that.

## Goals / Non-Goals

**Goals:**
- One shared body iterator; the checks and services both use it; property accessor bodies are covered.
- One shared callee resolver; signature-help and the call-argument check both use it.
- Implement the already-specified call-argument check (arity, type, named) conservatively (zero FP).
- No regression in corpus floors.

**Non-Goals:**
- Broadening what counts as a "checkable" type beyond the existing conservative set.
- Const-evaluated composite/member-count checks (tracked separately under build-st-language-server D.3).
- Project-wide scope — this change works over whatever document set the server holds; `eager-workspace-index` makes that the whole project.

## Decisions

- **R1 iterator lives in `symbols/`, not `syntax/`.** The iterator yields `scope` (from `scopeForUnit`, `symbols/scope-nav.ts`) as well as `statements` (from `parseStatements`, `syntax/`). `syntax/` cannot own it — it would need `Scope`, an upward dependency — and `services/` cannot own it either: `analysis/` and `services/` are siblings (verified: neither imports the other), so a `services/` home would be unreachable from the checks. `symbols/` is the one correct home — it already imports `syntax/` and owns `scopeForUnit`. Add `bodies(units, project) → { unit, body, scope, statements }` to `symbols/` (e.g. `symbols/bodies.ts`), parsing once and skipping graphical bodies. `syntax/bodies.ts` keeps the scope-free `unitBodies`. The checks pass their `CheckContext.project`; `stBodies` (`services/shared`) becomes a thin adapter over the `symbols/` iterator. Collapse `scopeForUnit`/`findScopeForUnit` to the single `symbols/` export and drop the `_shared.ts` alias.
- **R3 resolver lives with the type engine.** `resolveCallee(call, scope, project) → { sym, params }` in `types/` (next to `resolveMemberChain`) so both consumers import from one place. `signature-help` renders labels from `params`; the check validates against them.
- **C3 checks only the safe dimensions.** (1) too-many positional args vs declared inputs; (2) each positional arg (all-positional calls only) and each named arg type-compatible with its parameter via `types/` `isAssignable` — the same predicate `assignment.ts` uses, so wording/behavior match; (3) unknown named argument. Too-few is emitted only for callables that require inputs (FUNCTION), never FBs. Any unresolved callee/param type skips that dimension.
- **Messages centralized.** New codes (`call-argument-type`, `call-argument-count`, `unknown-named-argument`) in `analysis/messages.ts`, vendor-parameterized like the rest.

## Risks / Trade-offs

- **Accessor-body coverage could surface new diagnostics on real code.** Mitigated by the corpus ratchet: floors must not drop; any new ERROR on a built corpus object is a bug to fix before merge, not a ratchet bump.
- **Arity FP risk on FB inputs.** IEC FBs retain inputs between calls, so omission is legal — the check must not flag too-few for FBs. Encoded in the requirement and guarded by the "omitting an optional FB input" scenario.
- **Refactor blast radius (R1 touches every check).** Behavior-preserving except the intended accessor gain; the existing per-check tests plus the corpus ratchet cover it. Land R1 as its own commit, green, before adding C3.
- **Mixed named+positional ambiguity.** Explicitly not bound by index (existing requirement) — positional checking runs only on all-positional calls.
