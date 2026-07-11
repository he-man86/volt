## Why

The ST core (parser + AST + symbol/type model) that powers the LSP and the graphical sublanguage was always
meant to feed one more backend: a **Rust transpiler for headless test execution** — transpile a POU to Rust,
build it, drive scan cycles, and assert I/O, so PLC logic can be unit-tested off the IDE. This was the final
deferred task of `build-st-language-server` (X.1). That change's LSP/diagnostics scope is complete and archived,
so the transpiler epic gets its own home here. It is a **separate epic**: nothing in the LSP blocks on it, and
it blocks nothing shipping today.

## What Changes

- A `transpile/rust/` backend that consumes the shared ST AST/core (no re-parse) and emits Rust for a POU.
- A `test/exec/` harness: build the generated Rust, drive scan cycles, assert inputs→outputs.
- Scope bounded to **executable PLC-logic semantics** (not full IEC surface) — enough to test real POUs headlessly.

## Impact

- New: `packages/volt-lsp-iec/transpile/rust/` + `test/exec/`. Additive; reuses the existing core.
- No impact on the LSP, the bridge, or the shipping product — a standalone test-execution capability.
