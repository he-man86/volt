## Why

The ST frontend that powers the LSP (parser · AST · symbols · types) was always meant to feed one more
consumer: a **compiler backend for headless test execution** — take a POU, run its scan cycles, assert I/O, so
PLC logic can be tested without the IDE. This was the last deferred task of `build-st-language-server` (X.1);
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
