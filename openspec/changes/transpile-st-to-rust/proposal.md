## Why

The ST core (parser + AST + symbol/type model) that powers the LSP was always meant to feed one more
consumer: a **compiler backend for headless test execution** — take a POU, run its scan cycles, assert I/O,
so PLC logic can be tested off the IDE. This was the final deferred task of `build-st-language-server` (X.1);
that change's LSP scope is complete and archived, so the backend gets its own home here.

The original framing was "transpile ST to Rust". The deliverable is narrower and the spec already says so:
**executability**. Rust emission is one backend, valuable when the goal turns from testing logic to running
it somewhere the IDE is not. It is not the requirement.

## What Changes

A backend under `packages/volt-lsp-iec/src/transpile/`, consuming the existing frontend — no second parser,
no second type model:

```
AST ──lower/──> ir/ ──┬── interp/       runs it — the oracle
                      └── emit/rust/    prints it + a source map
```

- **`ir/`** — the one contract. Places (slot indices), not names; resolved `Type`s from `types/`.
- **`lower/`** — AST → IR, and the only place ST semantics are decided. Total: it never throws, and reports
  a coded `LowerDiagnostic` for anything it cannot represent.
- **`interp/`** — runs the IR. The reference the emitters are checked against.
- **`emit/rust/`** — IR → Rust + source map. A printer; if it has to decide something, lowering is incomplete.
- **`scripts/lower-completeness.ts`** — corpus coverage, ranked by what each construct would unblock.

Two decisions are load-bearing and are recorded in `docs/architecture.md` → Backend:
**nothing lowers to a Rust reference** (ST aliasing vs. the borrow checker is a fight this design declines),
and **the IR carries the semantics** so every backend stays a printer.

## Impact

- New: `src/transpile/{ir,lower,interp,emit/rust}` + `scripts/lower-completeness.ts`. Additive.
- `check-layering.ts` gains a rule: inside `transpile/`, only `ir/` crosses folders.
- No impact on the LSP, the bridge, or the shipping product.
