## Why

The C# bridges and the HTTP wire are shipped (CODESYS in-proc net48, Beckhoff standalone
net8, shared `Volt.Bridge.Core`). Walk them to verify the load-bearing wire invariants and
capture them as the `bridge-protocol` spec — the contract both vendors must honor identically.

## What Changes

- Author `specs/bridge-protocol/spec.md` — item-name-is-identity (and the *don't-throw-on-duplicates*
  rule), byte-identical vendor parity at the wire, the one declarative `set`/`delete` push wire,
  and the editable-graphical → VG handoff.

## Capabilities

### New Capabilities
- `bridge-protocol`: the HTTP wire keyed by bare item name; both vendor bridges serve byte-identical responses; pushes are one declarative `set`/`delete` list.

## Impact

Spec/docs only. Source of truth: `packages/volt-bridge/ARCHITECTURE.md`.
