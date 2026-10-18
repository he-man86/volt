## Decision

Split the list by what an entry IS. `unreadable: [{ name: "<folder>/<name>.<kind>", reason }]` holds items, named by the
one wire-name minter. `unreadableNodes: [{ name: "<folder>/<name>", reason }]` holds tree nodes with no file. Every member
is required. The engine's `Kinds` list becomes one `Kind`, and the removal exemption becomes full-path membership.

## Options considered

| Option | Wire shape | Verdict |
|---|---|---|
| A. As first proposed | `{ name?, object?, ordinal?, reason }` | Rejected. It is a bag of optional fields whose combinations mean different things, with two unmeasured cases (`ordinal`, a multi-extension family). It leaves the measured `Kinds = []` nodes undefined, mints `Untitled2.tmc.tmc` through `ItemKind.ExtFor`, and keeps libraries in the wrong folder. |
| **B. Two lists by what the entry is** | `unreadable: [{ name, reason }]`, `unreadableNodes: [{ name, reason }]` | **Chosen** |
| C. Full path where the kind is known, bare otherwise, in one field | `{ name, reason }` | Rejected. It puts two meanings in one field; a client must parse to tell a file path from a node path. |
| D. A `kind` member beside the bare name | `{ name, kind, reason }` | Rejected. It is a second way to say identity, and every client must re-implement the verbatim and library-folder rules. |

## Measurements the decision rests on

- Producers: 2 engine sites (`VersionedItem.Unread`, `CountUnclassifiable`), 9 driver sites (CODESYS
  `CodesysDriver.Tree.cs:72`, `:102`, `:115`, `:126`, `:164`, `:171`, `:177`; TwinCAT `BeckhoffDriver.Tree.cs:98`, `:126`).
  Each emits at most one kind.
- Kind known at the producer: the failed read, the excluded-folder item, the library reference and the C2i POU. These
  are items with a file.
- `Kinds = []`: measured live (the SP18 Library Manager, DIALECT V7). These are nodes with no file.
- `Kinds = null`: 0 current live cases. The only one (Pro2193, 2026-10-01) was Volt's own binder, fixed. It stays as the
  existing per-object catch, which owner-accepted `codesys-refs-guid-int32` kept. It is not new.
- Two unclassifiable objects of one name in one folder: 0 measured.
- Consumers: Volt's product code prints the name only (CLI 2 sites, volt-control 1 type). The e2e harness guesses the kind
  in 4 places to form a forced `deleteItem`, which is direct evidence that a client needs the full path.
- `Removal` shields only entries with a kind today (`Versioning.cs`, `o.Kinds is { }`). Moving `null`/`[]` entries to
  `unreadableNodes` therefore changes no removal answer.

## Cut, and the rule that cut it

- **`ordinal`.** 0 measured cases, and a node with no file needs nothing to tell it apart. Rule: measured cases only.
- **The "kind family spanning more than one extension" rule and its pin.** No producer can emit one. It is made
  unrepresentable (one `Kind`) instead of tested. Rule: measured cases only.
- **The optional `name`/`object` pair.** Replaced by two lists. Rule: no bag of optional fields.
- **"Engine keys unchanged".** With the full path on the wire, the bare-path + kinds removal key is the leftover of the
  removed design, and it carries the verbatim-kind bug. Rule: no leftover of a removed design.
- **`ItemKind.ExtFor(kind)`.** Replaced by the existing minter, which gets verbatim kinds and library folders right. Rule:
  one way to say each fact.
- **Task 1.2's TwinCAT POU + `.TcVIS` measurement.** Not needed once an item carries its full path.

## Protocol

An old client reading the new `unreadable` gets a different meaning without a refusal (it appends an extension and gets
`X.pou.pou`; it ignores `unreadableNodes`). That is a bump under `relay-protocol-tracks-wire-breaks`, so this change lands
in the protocol-2 release. Slipping it past the release costs protocol 3 and another PLCAssist relay redeploy.
