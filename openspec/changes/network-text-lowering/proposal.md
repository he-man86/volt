> Owner, 2026-10-29 (from Sim-Assist): Sim-Assist moves its PLC onto Volt's interpreter, with CODESYS-style LD and FBD
> editors that write plain-ST network text. "volt can def do that in the future", interpreter only, no Rust for now.
> DRAFT, written from Sim-Assist. Plan first, read-only first. Not started.

## Why

Since network-text-st and network-output-member, an LD/FBD body is plain ST (`docs/network-text.html`), the LSP reads
and checks it with the ST front-end, and the bridge round-trips it with CODESYS and TwinCAT. The transpiler still
refuses it by name:

```
src/transpile/lower/calls/routines.ts:232  "<name> is plain-ST network text, which is not lowered yet"  [graphical-body]
```

So no LD/FBD body runs in the interpreter (or in the Rust emitter, which starts from the same IR). Sim-Assist needs
LD and FBD programs to run in its simulator. It loads Volt's interpreter from a generated bundle
(`npm run build:volt`, `transpile.load`), so the change only lands through Volt.

What a network body MEANS is already decided and measured: the exec twin (`test/support/network-twin.ts` +
`-boxes.ts` + `-reads.ts`, 810 lines) writes, for every body, the CODESYS ST that runs as that network (EN/ENO as an
`IF`, an FB box called before the tree that reads it, wires as `VAR` kept across scans, `R_EDGE` as an `R_TRIG`,
`BRANCH_SHORTCIRCUIT`'s guard, the `EXECUTE` box, `%DISABLED` dropped, ...). Its rules are pinned by
`test/support/network-twin.test.ts` and by CODESYS: the twins of 44 corpus bodies build with 0 errors, and NWL traces
equal the twin traces on every spelled exec case (N24 20/20, 1.4 6/6, 1c 6/6). Lowering adds no new semantics: it runs
what the twin already says.

## What changes

- The transpiler lowers a plain-ST network body instead of refusing it. `graphical-body` stays for a body with no
  `%LANGUAGE` slot and for a body that is not ST (SFC, CFC, an XML-only body).
- The meaning is the twin's, rule for rule: one source of network semantics, used by both the lowering and the exec
  oracle. Where the twin refuses a box (`TwinRefusal`), the lowering refuses it by name with the same reason.
- Wires and ENO temps are hidden per-instance state (kept across scans, as measured in 2.3), named so no user identifier
  can collide (the `__` prefix, as `__clock`).
- `%DISABLED` networks lower to nothing; labels and `JMP` work across networks as in an ST body.
- Rust emission gets the same bodies for free (same IR).

## Open (for the owner, after the read-only step)

1. **Twin as source, or twin as oracle?** (a) Move the twin's rules into `src/` and lower the twin's ST AST. Then the
   twin is the lowering, and the oracle must be CODESYS (the recorded twin builds and exec traces), not the twin itself.
   (b) Lower network boxes directly to IR and keep the twin in `test/` as an independent oracle: two implementations
   of one meaning, compared on every corpus body. (b) costs more code and catches more; (a) is smaller. Measure the
   size of (b) before deciding.
2. **Debug paths for a wire.** A simulator (Sim-Assist trace, live values, forcing) shows a rung's wires. Are they
   readable through `Runner.get` by a stable path, and under which name?
3. **Behaviour on scan 1.** A wire read before its definition reads the previous scan's value: on scan 1 that is the
   type's default. Confirm against a recording.

## Non-goals

- New network syntax. The spelling is network-output-member's.
- SFC, CFC, IL.
- Editor support; that is the consumers' (Sim-Assist's LD/FBD editors write the text, PLC Assist reads it).
