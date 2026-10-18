## Decision

Refuse a `set` whose `to` the pre-apply version map holds, `ITEM_EXISTS`, in `PushService`'s pre-flight (which runs
under force), compared ignoring case. Every `set` whose `to` differs from its `name` ignoring case makes the push read
versions, so the map is filled under force too. Widen the key to the IDE's name scope and add vendor sentence matchers
only from task 1.1's measurement.

## Options considered

| Option | Wire | Verdict |
|---|---|---|
| A. Destination check on `PushConflicts`' simulated map moved out of the force skip; `UNREADABLE` for a `to` on an unknown-kind object; both drivers wrap every Rename/Move exception as `UNSUPPORTED` | Same codes | Rejected (below). |
| **B. Pre-flight `to` against the version map** | `ITEM_EXISTS` on `name`, reason names `to` | **Chosen** |
| C. B keyed by the IDE's measured name scope | Same as B | The extension of B, applied only from 1.1. |

`currentVersion` holds the version of the item already at the path in both cases (a create's target, a `to`), so the
code means one thing: "that path is taken; here is what is there". `ITEM_EXISTS`, not `BAD_REQUEST` (it is IDE state, not a rule about the request) and not `DUPLICATE_CHILD` (members
inside one pushed source, `PushService.cs:1319`): one code for "that path is taken".

## Measurements

- The gate passes a version-matching rename or move onto a held path: 0 conflicts (`PushConflicts.cs:114-118`); 0 tests.
- Every in-batch change to `to` is already refused by `RequireOneOpPerItem` (`touchedBy` holds `to`), so only the
  pre-apply walk can hold `to`: no forward simulation needed.
- Full identities (`name.kind`) exist only in the version map: `VersionedItem.Identity` derives them from the
  materialized item and nowhere else (`Versioning.cs:118-122`). `walk.Items` carries folder, bare name and kind code;
  `itemCache` is keyed by folder + bare name (`PushService.cs:57`), so it would refuse `Y.pou` beside `Y.visualization`
  and misses non-addressable items. Neither is the identity set.
- Under force with no lease and no bare-name change (a pure move), `needVersions` is false and the map is empty
  (`PushService.cs:47-49`). Hence: a `set` whose `to` differs from `name` ignoring case sets `needVersions` (a
  `relocating` flag beside `renaming`, which keeps driving `textsBefore` alone). Cost: a forced pure move reads versions,
  as a forced rename already does.
- IDE behaviour on a taken name: 0 vendor-fact rows. Related: CODESYS "already exists within the corresponding
  namespace" (duplicate method), TwinCAT D34 ("already exists on disk"), TwinCAT C2q (import refused for "name
  conflicts", and a clash-renamed re-import across folders). The name scope is unmeasured, with evidence for
  application-wide; hence task 1.1 and option C.
- Kind-null unclassifiable objects: 0 live cases (`unreadable-name-carries-kind`'s census; the one case was Volt's
  binder bug, fixed).
- `ITEM_EXISTS` consumers in Volt.Cli/volt-control: 0 special-cased.

## Cut, and the rule that cut it

- **`UNREADABLE` for a `to` on an unknown-kind object.** 0 measured cases. Rule: measured cases only.
- **The blanket `UNSUPPORTED` wrap of every driver Rename/Move exception.** Justified by an unmeasured race, and it
  would relabel Volt's own faults (`TcItemArchive`'s "could not be undone", `IDE_LOST_ITEM`) as IDE refusals. Rule: fail
  loud. Replaced by one sentence matcher per vendor, only for a refusal 1.1 measures reaching the apply.
- **The check on `PushConflicts`' simulated map, "moved out of the force skip".** The gate does not run under force.
  Rule: fix the root cause, which is that a forced move read no versions.
- **Rebuilding full names from `walk.Items` kind codes.** A second identity derivation. Rule: one place per rule.
- **Forward simulation of `to`.** The one-op-per-path rule already covers the batch.
- **"IDE holds `…/POUs/FB_A.pou` and `…/IO/FB_A.pou`".** A state the IDE likely cannot hold (namespace evidence above);
  replaced by a same-folder rename, plus another-folder only if 1.1 measures the scope.

## Protocol

No bump: same shape, same code. A request that applied today and now gets `ITEM_EXISTS` was one the IDE refused
(`INTERNAL_ERROR`) or silently clash-renamed; an old peer reads the refusal as a refusal.
