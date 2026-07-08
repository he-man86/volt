## Property gate
- [x] A round-trip test: `pull` → `push` (no edits) yields a no-op push (zero state-changing ops).
      → `idempotence.test.ts` (mock, always runs) + `live-idempotence.test.ts` (real bridge, skips if none).
- [x] Losslessness: `push X` → `pull` returns `X` byte-identical (`sourceText`, `folder`, `name`) for every
      writable kind (fb/prg/fun/itf/struct/union/enum/alias/gvl) including an editable VG graphical body.
      → the mock gate asserts byte-identity across the full kind matrix into a FRESH workspace.
- [x] Boundary shapes: emptied body, whitespace-only impl, graphical VG body in the mock matrix; the emptied-body
      **clear** property (the live-only data-loss regression) is asserted in the live gate.
- [x] Run for BOTH vendors: the live gate runs against whichever bridge is on `VOLT_TC_PORT` (8556 CODESYS /
      8555 TwinCAT); the wire is the parity boundary, so the same assertions cover both.

## Wiring
- [x] Hooked into the normal cadence: both files are plain `bun test` files under `volt-git`, so the package's
      turbo `test` task runs them with every check — no manual-only script.
- [x] Harness decided: **mock in CI** (hermetic, always green — guards the sync/materialize pipeline) + **live
      for real confirmation** (guards the bridge, skips cleanly when no compatible bridge is reachable). The live
      gate reuses the wire-version-aware `suite` from `live-harness`, so a stale bridge skips with a hint.

## On failure
- [x] Policy in place: the gate is authored to SURFACE data-loss (headers document it); any bug it finds gets a
      dedicated colocated regression test + a fix in a separate change (corpus-finds / src-acks policy). No bug
      surfaced by the runnable mock gate here; the live gate is pending a fresh compatible bridge.
