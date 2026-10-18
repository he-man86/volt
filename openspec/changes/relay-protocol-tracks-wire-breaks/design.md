## Decision

Protocol 2 for the path-wire release, which carries all three PLCAssist findings. One constant (`WireProtocol.Version`)
read by `hello`, `health` and the OpenRPC `info.version`. A gate pins the generated schema's hash beside it. The CLI refuses
a bridge whose `health.protocol` differs. The 1008 protocol line is neutral.

## Options considered

| Option | Shape | Verdict |
|---|---|---|
| A. As first proposed: bump, a prose rule, parse `(serves M)` from the relay's reason, `health.protocol` with no reader | ~80 lines + doc | Rejected (see Cut) |
| B. Bump only | ~3 lines | Rejected. It leaves the measured CLI ↔ stale CODESYS bridge data loss open, and nothing stops the next missed bump. |
| **C. Bump + schema pin + neutral line + `health.protocol` read by the CLI** | ~50 lines C# + ~40 test | **Chosen** |
| D. C without `health.protocol` | ~10 lines | Rejected. It knowingly ships the measured CLI data-loss path. |

## Measurements the decision rests on

- 5 breaking wire commits since the protocol existed, 0 bumps. A prose rule has failed 5 times in a row, so it is
  replaced by a check that fails CI.
- `docs/volt-bridge.openrpc.json` is already generated from the contract types and gated by `DocDataTests`, so its hash is
  a complete fingerprint of the wire SHAPE with no new extraction code. It carries no member descriptions
  (`DocDataTests.cs:325-375`), so a same-shape change of meaning passes it. All 5 measured breaks changed shape (members
  removed or renamed alongside any change of meaning), so the pin would have caught each one.
- `FakeIde` overrides `BuildHealthResponse` (`test/shared/FakeIde.cs:1398`); `BridgePipeHost.cs:104-109` already stamps
  host facts after the driver returns. `protocol` is a host fact, so it is stamped there.
- Stale in-proc bridge: `start_volt_codesys.py:154-208` stages a per-session DLL copy, and neither the installer
  (`installer/README.md:55-75`) nor the tray auto-update stops CODESYS. The new CLI therefore meets an old bridge after
  every update made with CODESYS open. An old bridge's `health` has no `protocol`, so the check refuses it.
- The relay that misleads today is an UN-redeployed one (still on 1). It cannot send anything new, so the bridge cannot
  learn the relay's number from it. Only a neutral line is right in both directions.
- `budgetMs` sits on the frame, not the body, so strict request bodies (`refuse-unknown-request-members`) do not affect it.

## Cut, and the rule that cut it

- **`(serves M)` in the relay's reason, its parser and two direction branches.** For 1 → 2 it fires in 0 cases: an
  un-redeployed relay cannot send it, and an updated relay refusing an old bridge already gets the right hint. It would
  also turn a third party's free-text reason into a parsed contract. Rules: measured cases only; no loose string where a
  structure belongs. The "PLCAssist sends `(serves 2)`" coordination item goes with it.
- **The fallback "no `(serves M)` → today's line".** It is a fallback, and it is the branch the motivating case takes.
- **The prose process rule ("each wire change states which kind it is").** It is replaced by the schema pin.
- **`health.protocol` without a reader.** A field no measured case reads. Kept only with the `BridgeClient` check.
- **`RelayFrames.Protocol` as a second constant.** One number, one place.
- **Member descriptions in the schema, to fingerprint meaning.** XML-doc extraction for 0 measured same-shape breaks, and a
  meaning change still passes when its author leaves the summary as it was. Rule: measured cases only.
- **A dedicated close code for a protocol refusal.** The motivating case is an UN-redeployed relay, which cannot send a
  new code; branching on it would miss exactly that case. The `protocol` substring is what every relay already sends, so
  it is stated as the contract instead of replaced.
- **A required C# `Protocol` member.** It would make the connector fail to read a stale bridge's `health`, which it must
  still read. Required on the schema, `int?` in C#, absent named "none" in the message.

## Bump rule (the sentence `relay-protocol.md` carries)

`protocol` changes when an old peer would read the new wire without refusing it and take a different meaning. Request
bodies are read strictly, so a new request member reaches an old strict bridge as a refusal and needs no bump. Responses
are read leniently, so a removed, renamed or re-meant response member needs one, and an added response member that an old
client can safely ignore does not.
