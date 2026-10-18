## Decision

One request options object, `WireJson.Request` (case-exact, `Disallow`), used by `Body<T>`. The two per-type attributes
are deleted. `PushOp` is abstract, so a missing discriminator is refused by the same read. `WireJson.Read` is case-exact
and keeps only unknown-member leniency.

## Options considered

| Option | Shape | Verdict |
|---|---|---|
| A. As first proposed: strict bodies, a retired-member hint table, a PascalCase pin, a `Volt.Repo.Gates` enumeration | ~150 lines | Rejected (see Cut) |
| **B. One strict request read in `Body<T>`** | ~6 src lines, generator +2, one test theory | **Chosen** |
| C. The attribute on every request DTO, plus a gate enumerating them | ~8 attributes, a ~40-line gate | Rejected. It needs a gate to stop a new type opting out, which B gets by construction. It is only better if a request type is read outside `Body<T>`, and that measures 0. |

## Measurements the decision rests on

- `Body<T>` is the only place in `src` that deserializes a request type. The CLI and the connector only serialize them.
- Request members retired by the path wire: 3. They are `knownFolders` on `refs`/`fetch`, and `toName` and `toFolder` on
  `set` (already refused). `folders`, `folder` and `newFolders` were RESPONSE members, which no client ever sent.
- Volt senders turned red: 6, all `build { buildType }` in `volt-lsp-iec/scripts`. There are 0 in the CLI, the connector,
  the e2e harness, `docs/doc.js` and volt-control.
- PascalCase request senders: 0. Pins: 0.
- `System.Text.Json`'s `Disallow` exception already passes through `Body<T>`'s `BAD_REQUEST` wrapper, which names the op
  and the member. The existing `toFolder` test (`PipeTransportTests.cs:324-342`) exercises exactly this path.

## Cut, and the rule that cut it

- **The retired-member hint table** (`knownFolders` → `knownApplications`, …). It is a table of retired member names, the
  leftover of a removed design. Three of its five entries were never request members. The plain message names the
  member, and the protocol number (`relay-protocol-tracks-wire-breaks`) is what tells an old peer the wire moved.
- **Keeping case-insensitive request members, and its pin.** It is a compat path with 0 senders, and it gives each member
  two spellings. Rules: no backward compatibility; one way to say each fact.
- **The `Volt.Repo.Gates` enumeration.** It is unnecessary when strictness lives in the one read every body takes.
- **"The design step picks attribute or options."** Decided: options.
- **Case-insensitive frames and responses.** Same 0-sender compat as for requests (`PipeServer.cs:229`,
  `BridgeClient.cs:40`, `PerPipeProjectSource.cs:112`). Rule: no backward compatibility. Unknown-member leniency stays: it
  is what lets an added response member ship without a bump.
- **A concrete `PushOp` and its dispatch-time refusal.** Two places refuse one mistake. Rule: one way to say each fact.
- **A pin that responses stay lenient.** Response leniency is the relay change's rule (an additive response member does
  not bump the protocol; a changed meaning does). It is not this change's behaviour to pin.

## What strictness does not cover

Strictness protects a NEW bridge from an OLD or drifted client. It cannot help a NEW client against an OLD, lenient bridge
(a stale in-proc CODESYS bridge, or an engineer's un-updated bridge behind PLCAssist's relay). Protocol 2 in `hello` and
`health` closes that pair (`relay-protocol-tracks-wire-breaks`).

A refused `connect` body is refused after `_paused = false` (`BridgePipeHost.cs:124`), like any refused `connect`. No IDE
work runs first, so this stays as it is.
