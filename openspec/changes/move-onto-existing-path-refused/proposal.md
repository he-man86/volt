> Standalone. No wire shape change and no new code (`ITEM_EXISTS` exists), so no protocol bump. Uses the address rule
> and comparer of `one-path-comparer` (an addressed path finds the IDE item ignoring case). Lands after
> `unreadable-name-carries-kind` or builds its walk set from `walk.Items` only until that lands.

## Why

A `set` with `to` renames and/or moves an item (`packages/volt-cli/src/Volt.Contracts/Wire/PushModels.cs`). Nothing
before the apply asks whether `to` already names an item:

- **The gate overwrites it.** `PushConflicts.DetectConflicts` removes the source and writes `pending[to] = ""` without
  looking `to` up (`src/Volt.Engine/Sync/PushConflicts.cs:114-118`). No test covers it.
- **The pre-flight checks the destination folder and application, not the path** (`PushService.cs:170-199`).
  `RequireOneOpPerItem` (`:834`) refuses two ops on one path, not an op onto a path no other op names.
- **The apply hands it to the IDE**: `ide.Rename` (`PushService.cs:991`) or `MoveItem` (`:1022`, vendor move `:1081`);
  neither driver checks first. A vendor throw that is not an `ICodedError` becomes `INTERNAL_ERROR` (`ConflictFor`,
  `:478-480`), which `wire.html:180` reserves for Volt's own faults, and earlier ops of the batch have already landed.
  TwinCAT's move is an archive import, and XAE silently renames a clashing import (`X_1`, DIALECT C2q).
- **A create onto an existing path is already `ITEM_EXISTS`** (`PushConflicts.cs:98-107`). Only `to` is missing.

Who reaches it: a client that renames or moves by path without a lease, or with `force` (Volt's CLI sends no lease under
`--force`, `Commands.cs:451-453`). PLC Assist reported it.

## What Changes

- **A `to` the IDE already holds is refused `ITEM_EXISTS` before anything of the batch is applied**, force or not. The
  check sits in `PushService`'s pre-flight beside the move-target and application checks (which run under force) and
  reads the pre-apply walk, not the version map (empty for a forced pure move, `PushService.cs:47-49`). Reason:
  "`<name>` cannot become `<to>`: the IDE already holds an item there."
- **No simulation.** `RequireOneOpPerItem` already refuses every other op of the batch on `to` (a create, a delete,
  another rename), so the pre-apply walk is the only thing `to` can collide with.
- **Same item, same comparer.** `to` equal to `name` ignoring case is the item itself (a case-only rename). The walk's
  paths are compared ignoring case (`StringComparer.OrdinalIgnoreCase`, the address rule of `one-path-comparer`). Identity
  is the full path, kind included: `Y.pou` beside `Y.visualization` is no collision.
- **The scope follows the IDE.** Task 1.1 measures whether each IDE refuses or clash-renames a name held in another
  folder of the same application. If it does, the check is keyed by (application, bare name) for the kinds the
  measurement shows sharing that scope. A vendor exception the measurement shows still reaching the apply gets one
  sentence matcher per vendor (as `ChildRefused` does for `CreateChild`), never a catch-all.

## Impact

- `Volt.Engine/Sync/PushService.cs` (pre-flight), possibly one sentence matcher per driver (only if 1.1 measures one).
- Tests: `Volt.Engine.Tests` (FakeIde); live e2e on both vendors for 1.1, recorded in DIALECT.
- `wire.html`: the `ITEM_EXISTS` row covers `to`.
