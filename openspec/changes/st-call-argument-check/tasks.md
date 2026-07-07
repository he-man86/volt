## 1. R1 — Unify body iteration (refactor)

- [x] 1.1 Add a scope-aware body iterator to `src/symbols/` (e.g. `symbols/bodies.ts`): `bodies(units, project) → { unit, body, scope, statements }`, parsing each body once, skipping graphical bodies, and covering property getter/setter accessor bodies. (It needs `Scope`, so it belongs in `symbols/`, not `syntax/`; `syntax/bodies.ts` keeps the scope-free `unitBodies`.)
- [x] 1.2 Rewrite every `src/analysis/checks/**` check to iterate via it (drop the inline `for unit … getBody … findScopeForUnit … parseStatements` loops).
- [x] 1.3 Reimplement `services/shared/resolve-at.ts` `stBodies` as a thin adapter over the shared iterator.
- [x] 1.4 Collapse `scopeForUnit` / `findScopeForUnit` to the single `symbols/` export; remove the `_shared.ts` alias re-export.
- [x] 1.5 Verify no diagnostic regression: run the per-check tests + corpus ratchet; confirm accessor bodies are now included (floors hold or improve).

## 2. R3 — Shared callee resolver (refactor)

- [x] 2.1 Add `resolveCallee(call, scope, project) → { sym, params }` in `src/types/` next to `resolveMemberChain`.
- [x] 2.2 Rewrite `services/assist/signature-help.ts` to render its labels from `resolveCallee` (no local resolution).

## 3. C3 — Call-argument check

- [x] 3.1 New `src/analysis/checks/calls/call-arguments.ts`: over the shared iterator, for each call resolve via `resolveCallee`; skip when callee or a param type is unresolved.
- [x] 3.2 Flag too-many positional arguments vs declared inputs; too-few only for callables that require inputs (FUNCTION), never FBs.
- [x] 3.3 Type-check each argument against its parameter with `types/` `isAssignable` (all-positional calls for positional args; always for named args).
- [x] 3.4 Flag an unknown named argument (a `name := value` naming no declared parameter).
- [x] 3.5 Register the check in `src/analysis/diagnostics.ts` `CHECKS`; add `call-argument-type` / `call-argument-count` / `unknown-named-argument` wording to `src/analysis/messages.ts` (vendor-parameterized).

## 4. Tests

- [x] 4.1 Wrong argument type flagged (FB input `INT` called with `STRING`).
- [x] 4.2 Too many positional arguments flagged.
- [x] 4.3 Unknown named argument flagged.
- [x] 4.4 Mixed named+positional does not false-positive on the trailing positional.
- [x] 4.5 Omitting an optional FB input is NOT flagged.
- [x] 4.6 Unresolved callee / param type → no diagnostic (zero-FP).
- [x] 4.7 A property accessor body with an assignment mismatch is now diagnosed (R1 coverage).
- [x] 4.8 Corpus ratchet unchanged (zero-FP floors hold).

## 5. Docs

- [x] 5.1 Noted the shared body iterator in the layer map (`docs/architecture.md` B-layer line: "bodies — the shared ST-body iterator"). No package README exists (the design-of-record is `openspec/specs/st-language-server/`); the call-argument requirement + accessor-coverage requirement live in the spec delta, synced on archive.
