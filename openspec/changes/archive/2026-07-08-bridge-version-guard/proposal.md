## Why

The bridge advertises `version` on `/health`, but it is hardcoded `"1.0.0"` (`DriverBase.cs:36`), never
bumped, and **no client ever reads it**. There is zero compatibility check between the `volt-git` CLI and the
bridge it talks to. The wire shape has changed repeatedly (push ops, `/fetch` fields, diagnostics) and will
again — so an old bridge against a new client (or the reverse) fails today with a cryptic zod parse error at
best, and **silently-wrong data at worst**. The in-proc CODESYS bridge is the acute case: it loads from a copy
inside the IDE and can lag the installed CLI independently — exactly the documented "stale bundled bridge served
wrong TwinCAT data" incident. A single, cheap guard turns that class of failure into one actionable message.

## What Changes

- Add an integer **`wireVersion`** to `/health`, distinct from the display `version` string.
- **Single source of truth**: `WIRE_VERSION` in the TS wire types and `WireVersion` in Core, bumped together
  only on an *incompatible* wire change.
- `BridgeClient` reads `wireVersion` on its first `/health` and throws **`PROTOCOL_MISMATCH`** with an
  actionable message (e.g. "this bridge speaks wire v3, Volt needs v5 — restart CODESYS / reinstall Volt")
  when it doesn't equal what the client speaks. Checked once, then cached.
- `check-volt-integration.ts` asserts the two constants are equal, so they cannot silently drift.
- Fold in two client smells in the same file: match Node `err.code` (`ECONNREFUSED`/`ETIMEDOUT`) instead of
  message substrings (`client.ts:165-170`); per-endpoint timeouts — fast `/health`, long `/build` — instead of
  one flat 60s (`client.ts:51`).

**Non-goals** (deliberate — a single-installer product ships client and bridge together): semver ranges,
capability negotiation, backward-compatibility windows. The guard exists only to catch drift / stale copies,
not to support mixed versions.

## Impact

- `packages/volt-bridge` — `Wire/HealthResponse.cs` (+ `wireVersion`), `Ide/DriverBase.cs` (the constant).
- `packages/volt-git` — `bridge/types.ts` (`WIRE_VERSION` + schema field), `bridge/client.ts` (the check +
  `err.code` + per-endpoint timeouts).
- `volt-scripts/check-volt-integration.ts` — cross-language constant-equality guard.
- **Parity**: a Core-level constant, identical for both vendors.
- Adding the field is non-breaking; the *check* is new refusal behavior on mismatch (the point).
