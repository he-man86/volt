## Why

The ST frontend that powers the LSP (parser · AST · symbols · types) was always meant to feed one more
consumer: a **compiler backend for headless test execution** — take a POU, run its scan cycles, assert I/O, so
PLC logic can be tested without the IDE, with an ordinary test framework (`cargo test`, `bun test`) rather than
a PLC-specific one. This was the last deferred task of `build-st-language-server` (X.1);
that change's LSP scope is complete and archived, so the backend gets its own home here.

The original title says "transpile ST to Rust". The requirement is narrower, and the spec already said so:
**executability**. Rust emission is one backend — the one that matters when the goal turns from *testing*
logic to *running* it where the IDE is not. It was never the deliverable.

## What Changes

A backend at `packages/volt-lsp-iec/src/transpile/`, consuming the existing frontend — no second parser, no
second type model, no second table of IEC facts:

```
AST ──lower/──> ir/ ──┬── interp/       runs it — the oracle
                      └── emit/rust/    prints it + a source map
```

- **`ir/`** — the one contract. Places (slot indices), not names; a resolved `types/` `Type` on every node.
- **`lower/`** — AST → IR, and the only place ST semantics are decided. **Total**: never throws, and reports
  a coded `LowerDiagnostic` for anything it cannot represent.
- **`interp/`** — runs the IR. The reference every other backend is checked against.
- **`emit/rust/`** — IR → Rust + source map. A printer.
- **`scripts/lower-completeness.ts`** — corpus coverage, ranked by what each construct would unblock.

Decisions are recorded in `design.md`; the two that carry the design are **nothing lowers to a Rust
reference** and **the IR carries the semantics**.

## The evidence this is built on

Measured over the 4-project corpus (26,175 source files), not estimated:

| | |
|---|---|
| PROGRAM/FUNCTION_BLOCK units | 6,079 — but only **301 have a body with statements** |
| METHOD/ACTION bodies | **34,090** — where the code actually lives |
| lowering coverage today | **1 of 301** (the executable core only) |
| bare-name calls | 4,481 — 1,505 resolve in-project |
| …compiler built-ins | **2,424 sites / 81 distinct** — bounded, IEC-specified, mandatory |
| …genuinely external (library) | ~552 sites / ≤149 distinct — unbounded, stub-able |
| most-called name in the corpus | **`ADR`, 333 sites** |

Two of these changed the plan. `ADR` being the single most-called construct makes pointers a first-order
concern rather than a late edge case — so the memory model must be settled before instances and methods are
built on top of it. And the built-in surface being 81 names rather than an open-ended library makes the
biggest-looking cost the most tractable one.

## Impact

- New: `src/transpile/{ir,lower,interp,emit/rust}` + `scripts/lower-completeness.ts`. Additive.
- `scripts/check-layering.ts` gains one rule: inside `transpile/`, only `ir/` crosses folders.
- `docs/architecture.md` → Backend rewritten to describe what exists.
- No impact on the LSP, the bridge, or the shipping product.

## Close-out (2026-10-03)

Closed with **82 of 121 tasks done**. What was built: the backend at `packages/volt-lsp-iec/src/transpile/`
(`ir/`, `lower/`, `interp/`, `emit/rust/`), the CODESYS execution oracle and its recordings, the fixture
programme, the library repo (`libraries/<lib>/<version>/`, Standard as ST), form-1 and form-2 pointers, interfaces,
`EXTENDS`, VAR_IN_OUT / VAR_IN_OUT CONSTANT binding, UNION, aggregate initializers, and `scripts/lower-completeness.ts`.
The spec delta was narrowed to that: its aliasing requirement had said the only borrow in emitted Rust is
`&mut self` and that it builds with warnings as errors — the built emitter lends `&mut`/`&` for the duration of a
call (VAR_IN_OUT, VAR_IN_OUT CONSTANT, form-2 pointer parameters, `g`, `prg`) and lints by ratchet, not by
`-D warnings` — and its vendor-behaviour requirement no longer claims every uncompared implementation is marked at
its definition.

The 39 open tasks were handed over, none dropped: **6 superseded** by `transpile-restructure` (which owns the
pointer model and output timing), **33 backlog** (feature growth that change declares a non-goal; listed verbatim
in its tasks.md under "Hand-off from transpile-st-to-rust"). Each open line in `tasks.md` carries its verdict.

| # | Open task (tasks.md section) | Verdict |
|---|---|---|
| 1 | C0582's wording (LSP gaps) | Backlog — LSP decision for the user |
| 2 | Standard's functions and blocks hard-coded as always-present names, gap 10 (LSP gaps) | Backlog — parked by the user 2026-09-14 |
| 3 | Push round-trip through the bridge (route the oracle through the bridge) | Backlog |
| 4 | Build parity through the bridge (same) | Backlog |
| 5 | Execution through the bridge, a `run` op (same) | Backlog |
| 6 | A PROGRAM called from an FB body (phase 3½) | Backlog — `state_program_called_from_fb` lowers and is confirmed today; corpus reach unmeasured |
| 7 | A routine's VAR_OUTPUT as a local copied back after the call (review 2026-09-15) | Superseded by transpile-restructure 4.11 (RC 20) |
| 8 | A multi-target handle for stored POINTER/REFERENCE, `pointer-targets` (same) | Superseded by transpile-restructure 4.2 (model 3) |
| 9 | Form 2 first (same) | Superseded by transpile-restructure 4.2 — built (`pointers/borrowed.ts`); 4.2 decides what stays |
| 10 | REFERENCE/POINTER inputs of a routine as borrows, and interface inputs (same) | Superseded by transpile-restructure 4.2 |
| 11 | Library FUNCTION/FB with an absent body — the stub mechanism (plan from here) | Backlog — the next proposal, per the user 2026-09-16 |
| 12 | `place-not-local` +4 (2026-09-16 order) | Backlog |
| 13 | `init-not-constant` +3 (same) | Backlog — sole 0 on 2026-09-21 |
| 14 | `graphical-body` +6 (same) | Backlog |
| 15 | `place-shape` +4 (same) | Backlog |
| 16 | `pointer-order` +5 (same) | Backlog — restructure 4.1's census measures it; no feature work there |
| 17 | `call-body` +5 (same) | Backlog — sole 0 on 2026-09-21 |
| 18 | `aggregate-init` +3 (same) | Backlog — gone from the 2026-09-21 table |
| 19 | `enum-value` +17 (same) | Backlog — gone from the 2026-09-21 table |
| 20 | `call-param` +4 (same) | Backlog — gone from the 2026-09-21 table |
| 21 | `interface-type` +3 (same) | Backlog — sole 0 on 2026-09-21 |
| 22 | `expr-member` +4 (same) | Backlog — sole 0 on 2026-09-21 |
| 23 | `stmt-try` +3 (same) | Backlog |
| 24 | `layout-union` +4 (same) | Backlog — gone from the 2026-09-21 table |
| 25 | `conversion-type` · `fb-init-argument` · `expr-call` · `call-inout-alias` · `stmt-call_stmt` (same) | Backlog |
| 26 | `place-not-local` +7 sole (re-measured 2026-09-21) | Backlog |
| 27 | `graphical-body` +6 sole (same) | Backlog |
| 28 | `stmt-try` +3 sole (same) | Backlog |
| 29 | Then re-measure with `lower-completeness.ts` (same) | Backlog |
| 30 | `VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref` on the phase-3 model (phase 4) | Superseded by transpile-restructure 4.2 (model 3) |
| 31 | `__ISVALIDREF` and the pointer built-ins (phase 4) | Backlog — `__ISVALIDREF` lowers today; the rest of the family unmeasured |
| 32 | Interfaces, `EXTENDS`, `__QUERYINTERFACE` — dynamic dispatch (phase 5) | Backlog — every sub-item done; the open `interface-*` refusals remain (restructure 4.10 fixes only RC 18) |
| 33 | `__POUNAME` and the other CODESYS compiler operators (phase 5) | Backlog — `__POUNAME` lowers today; the others unmeasured |
| 34 | `expr-assign_expr` (phase 5) | Backlog |
| 35 | `stmt-try` (phase 5) | Backlog |
| 36 | `type-unknown` triage (phase 5) | Backlog |
| 37 | Stub mechanism for third-party library FBs (phase 6) | Backlog |
| 38 | `instanceRelative` treats the root FB's own frame as multi-instance (carried over 2026-09-19) | Superseded by transpile-restructure 4.14 (resolved or left with a reason) |
| 39 | A TwinCAT build pass for the program cases (carried over) | Backlog — parked by the user 2026-09-14 |

Rows 12-25 are the 2026-09-16 greedy order, which the file kept "for what it shows about the method"; rows 26-29
are its 2026-09-21 re-measurement and the live list. Duplicates (`place-not-local`, `graphical-body`, `stmt-try`)
are handed off as one item each.
