## Why

The spec already requires call-argument checking — "Call arguments are checked against the callee signature" (`openspec/specs/st-language-server/spec.md`) — but the audit found **no such check is registered**: the `CHECKS` array in `analysis/diagnostics.ts` has no arg-count / arg-type / unknown-named-argument check. Signature *help* exists, but nothing flags a wrong call, so an AI writing a bad call sees no LSP error (only the IDE build catches it). Implementing it cleanly first requires removing two duplications the audit surfaced, so the new check reads as native rather than a tenth copy:
- **R1:** every check re-implements the same body-iteration loop (`parseResult.units → body → scope → parseStatements → walk`) inline, and it exists a second time as `stBodies` in `services/shared/resolve-at.ts`. Worse, the two disagree: analysis's `getBody` (`checks/_shared.ts:44`) excludes property getter/setter bodies, while services' `unitBodies` includes them — so type checks silently skip accessor bodies that navigation sees.
- **R3:** resolving a call expression to its callee symbol + parameters lives inline in `signature-help.ts:30`; the new check needs the identical resolution.

## What Changes

- **R1 — one body-iteration primitive.** Introduce a single scope-aware body iterator `bodies(units, project) → {unit, body, scope, statements}` in `symbols/` (it needs `Scope`, so it can't live in `syntax/`, and `analysis`/`services` are siblings so it can't live in `services/` either — `symbols/` is the only cycle-free home), covering all POU bodies **and property accessor bodies**. Rewrite the analysis checks and `stBodies` over it; collapse the duplicated `scopeForUnit`/`findScopeForUnit` names into one.
- **R3 — one callee resolver.** Extract `resolveCallee(call, scope, project) → { sym, params }` (shared) used by both `signature-help` and the new check.
- **C3 — the call-argument check.** New `analysis/checks/calls/call-arguments.ts` registered in `diagnostics.ts`: too-many positional arguments, argument type incompatible with its parameter (reusing `types/` `isAssignable` — the same engine as `assignment.ts`), and unknown named argument. Conservative: skip when the callee or a parameter type can't be resolved (zero FP); positional type-checking only on all-positional calls. Wording in `analysis/messages.ts`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `st-language-server`: add a requirement that diagnostics traverse **all** ST bodies (including property accessors) through one shared iterator; and strengthen the existing call-argument requirement with an explicit too-many-arguments scenario (the requirement was specified but not implemented — this change makes it enforced).

## Impact

- **Code:** new `src/analysis/checks/calls/call-arguments.ts` + registration in `src/analysis/diagnostics.ts`; new wording in `src/analysis/messages.ts`; refactor of `src/syntax/bodies.ts` (add the scope-aware iterator), every `src/analysis/checks/**` file (iterate via it), `src/services/shared/resolve-at.ts` (`stBodies` over it), and `src/services/assist/signature-help.ts` (use `resolveCallee`).
- **Behavior:** checks now also diagnose property accessor bodies (previously skipped) — an intentional coverage gain, guarded by the corpus ratchet (zero-FP floors must hold).
- **Dependencies:** independent of `eager-workspace-index` (works on the current open-doc set); with that change it simply becomes project-wide. R1/R3 are prerequisites *within* this change.
- **Tests:** unit tests for each C3 dimension; a test proving an accessor body is now checked; corpus ratchet unchanged.
