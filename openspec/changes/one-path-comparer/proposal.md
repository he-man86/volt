> Answers the PLC Assist finding: a directed read (`fetch.onlyItems`) with a path in another case answers nothing,
> although push resolves the same path.
>
> Standalone. Every request that works today answers the same, so no protocol bump: it lands before or after protocol 2
> (`relay-protocol-tracks-wire-breaks`) in any order. It shares one doc sentence and one comparer with
> `move-onto-existing-path-refused`.

## Why

PLC Assist's AI addresses items by a path it was given in another case. Push resolves such a path: `PushService` keys
`itemCache`, `validated` and `RequireOneOpPerItem` with `StringComparer.OrdinalIgnoreCase`
(`packages/volt-cli/src/Volt.Engine/Sync/PushService.cs:53`, `:144`, `:834-840`), and `wire.html:110-111` documents it.
The directed read does not:

- `FetchService.cs:40` builds `onlyItems` as `new HashSet<string>(request.OnlyItems)`, which is ordinal. `:83` tests
  `named = onlyItems.Contains(path)` and `:99` skips an item that is not named. A `fetch { onlyItems:
  ["device/plc logic/application/fb_motor.pou"] }` against `Device/Plc Logic/Application/FB_Motor.pou` answers nothing,
  and nothing says why.

So the wire gives two answers to "does this path name that item": yes on push, no on a directed read. IDE paths are
unique ignoring case (IEC names are unique case-insensitively within a kind, both IDEs resolve them that way,
`ItemLookupTests.cs:32`, and the kind extension separates kinds), so a case-insensitive match is never ambiguous.

`knownItems` is a different question and stays exact. A key the client HOLDS is answered back as sent: a spelling the
IDE no longer has is in `removed` (`Removal.cs:60`). Volt's own CLI needs exactly that: `IdeTree.BuildVoltIdeTree`
subtracts `removed` from a case-sensitive git tree with an ordinal set, so a case-only rename in the IDE (`Calc` →
`calc`) must answer `removed: [Calc.pou]` and `items: [calc.pou]` to leave one entry in `refs/remotes/volt/ide`. Nothing pins that today.

## What Changes

- **An addressed path finds the IDE item ignoring case.** `onlyItems` is built with `StringComparer.OrdinalIgnoreCase`,
  as push's `name` and `to` already are. The answer spells the IDE's path (`Name = v.Identity`, unchanged).
- **A held key is exact.** `knownItems` → `removed` is unchanged and pinned: a case-only rename in the IDE answers the
  old key in `removed` and the new path in `items`. Whether a CLI pull then leaves one file in the WORK TREE (native
  `git merge` of a case-only rename on a case-insensitive file system) is measured, not assumed (task 1.3).
- **One rule in `wire.html`'s identity section**, replacing the push-only clause at `:110-111`: "A path you address
  (`onlyItems`, a push op's `name` and `to`) finds the IDE item ignoring case, and every answer spells it as the IDE does.
  A key you hold (`knownItems`) is exact: a case-only rename in the IDE is the old key in `removed` and the new one in
  `items`."

## Impact

- `Volt.Engine/Sync/FetchService.cs` (one comparer).
- Tests: `Volt.Engine.Tests` (directed read in another case, case-only rename pin), `Volt.Cli.Tests` (pull pin).
- `docs/wire.html` identity section.
