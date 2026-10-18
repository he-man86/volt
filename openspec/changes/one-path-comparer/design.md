## Decision

One comparer at the one read site that resolves a path the client addresses: `onlyItems` (`FetchService.cs:40`) becomes
`OrdinalIgnoreCase`, as push's `name`/`to` already are. Held keys (`knownItems` → `removed`) stay exact. `wire.html`
states the address-vs-held-key rule once.

## Options considered

| Option | Wire | Verdict |
|---|---|---|
| A. One case-insensitive comparer everywhere (`onlyItems`, `knownItems`, unreadable, unwalked folders, version maps) plus a repo gate banning comparer-less collections | Shape same; `removed` changes meaning | Rejected. Breaks Volt's own CLI (below), needs a protocol bump, most rows have no measured case. |
| **B. Addressed paths ignore case, held keys exact** | Unchanged; a miscased directed read now finds the item | **Chosen** |
| C. Keep `onlyItems` ordinal, refuse a directed read naming no IDE item | New refusal | Rejected. `volt show BRIDGE` (`Commands.cs:1007`) treats an absent item as a normal diff (exit 2), and a miscased path would be refused although push resolves it. |
| D. Doc only: reads are exact | Unchanged | Rejected. Two answers to one question (push yes, read no). |

## Measurements

- Client-addressed read sites: one, `FetchService.cs:40`/`:83`. `namedLibRefs` (`:132`) compares IDE spelling with IDE
  spelling. Every other read site compares a client-HELD key and answers it back.
- `removed` consumer: `Commands.cs:384` → `IdeTree.BuildVoltIdeTree`, an ordinal `removedSet` over a case-sensitive git
  tree. Under A, a case-only IDE rename leaves `Calc.pou` and `calc.pou` in `refs/remotes/volt/ide` (git's "paths have
  collided" on Windows). Today's answer leaves one tree entry; the work tree after `git merge` is unmeasured (task 1.3). No test pins it (`case-only` in `test/` is push-side only).
- Volt's own `onlyItems` senders (`Commands.cs:910`, `:1007`, `test/e2e/lib/workspace.ts:339`) send the IDE's spelling
  from `refs`; same-case requests answer identically under B.
- IDE paths are unique ignoring case (`ItemLookupTests.cs:32`, the kind extension), so B is never ambiguous.

## Cut, and the rule that cut it

- **`knownItems` ignoring case, and "a case-only rename answers nothing in `removed`".** A held key in another case is,
  to the bridge, indistinguishable from a case-only rename, and today's answer is the one a case-sensitive git tree
  needs; A's answer corrupts the CLI's tree. Rule: fix the root cause. It also keeps this change out of the protocol bump.
- **Unreadable and unwalked-folder rows ignoring case.** No measured case; the unreadable machinery is being reshaped by
  `unreadable-name-carries-kind`. Rule: measured cases only.
- **The `Volt.Repo.Gates` comparer ban and its allow-list.** Most comparer-less path collections in `Sync`/`Item` are
  correctly ordinal; the gate would be an exception table for an unmeasured class. Rule: measured cases only.
- **Version maps built with the comparer.** IDE keys are unique ignoring case already; nothing measured changes.
- Left to `volt-cli-rework` ("one place per rule"): `Removal.UnderAny` duplicates `ItemPath.IsUnder` with another
  comparer. That is dedup, not a new rule.

## Protocol

No bump. Under `relay-protocol-tracks-wire-breaks`' rule (bump when an old peer reads the new wire without refusing and
takes another meaning), an old peer's correct requests answer identically; only directed reads that answered empty now
answer the item they named.
