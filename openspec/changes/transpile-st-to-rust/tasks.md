Deferred epic rehomed from `build-st-language-server` (task X.1). Not started; nothing blocks on it, and it
blocks nothing shipping. Held here as the transpiler's home.

## Transpile backend
- [ ] Emit Rust from a POU's ST AST — reuse the existing parser / AST / type model (no re-parse).
- [ ] Cover the executable core: assignment, arithmetic/boolean/compare expressions, IF/CASE, loops, FB
      instances + method/FB calls.

## Exec harness
- [ ] `test/exec/`: build the generated Rust, drive N scan cycles, assert input→output tuples.
- [ ] First end-to-end case: a real corpus POU transpiles, builds, and produces the expected I/O.

## Decide scope
- [ ] Define the executable-semantics boundary (in vs. out — e.g. timers, strings, pointers, retain) and record
      it, so "what the transpiler is expected to run" is explicit.
