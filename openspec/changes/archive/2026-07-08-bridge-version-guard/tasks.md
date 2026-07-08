## Wire
- [x] Add a `WireVersion` int constant to Core; surface `wireVersion` on `HealthResponse` (keep the `version`
      string for display only).
- [x] Add `WIRE_VERSION` const + `wireVersion` to `HealthResponseSchema` in `volt-git/src/bridge/types.ts`.

## Client guard
- [x] `BridgeClient`: on the first `getHealth`, compare `wireVersion`; throw
      `BridgeError("PROTOCOL_MISMATCH", <actionable message>, 426)` on mismatch. Cache the result so it runs once.
- [x] `isBridgeOfflineError`: key on `err.code` (`ECONNREFUSED`/`ETIMEDOUT`/`ENOTFOUND`), not message substrings.
- [x] Per-endpoint timeouts: `/health` ~3s, `/refs`/`/fetch` ~10-30s, `/build` long. Replace the single flat 60s.

## Drift guard + tests
- [x] `check-volt-integration.ts`: fail if the TS `WIRE_VERSION` and C# `WireVersion` constants differ.
- [x] Test: client throws `PROTOCOL_MISMATCH` against a mock `/health` reporting a different `wireVersion`.
- [x] Test: offline detection keys on `err.code` (simulate `ECONNREFUSED`).

## Docs
- [x] Document the "bump BOTH constants together, only on an incompatible wire change" rule next to each
      constant and in the `volt-bridge` / `volt-git` READMEs.
