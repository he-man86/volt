> Answers the PLC Assist finding of 2026-10-19 (production pull of Pro2193 on 0.1.17884): every item inside a folder
> marked Exclude from build is in `unreadable` with "it is not built, so it is not pulled as a built one". PLC Assist's
> owner may want the AI to read and edit such items.
>
> No wire member changes; protocol stays 1: the items and the new descriptor kind are content. Applies the container
> descriptor rule written in `codesys-application-defines-spelled` (proposal, "The rule").

## Why

- CODESYS: `ContainerRefusal` reads a folder's build property (`Volt.Ide.Codesys/Ide/CodesysObjectModel.Properties.cs`);
  for an excluded folder the walk lists the folder in `unreadableNodes` and every item under it in `unreadable`
  (`Driver/CodesysDriver.Tree.cs:112-133`), and the push refuses ops on them (`Volt.Engine/Sync/PushService.cs:92`,
  `:206`). The items' code reaches no client.
- An item excluded by its OWN build property is pulled and carries `%EXCLUDE_FROM_BUILD`
  (`Volt.Engine/Format/St/PropertyLines.cs`). Only the folder's exclusion has no text.
- TwinCAT lists an item whose `.plcproj` `<Compile>` entry holds anything but `<SubType>` as unreadable
  (`Volt.Ide.Twincat/Driver/BeckhoffDriver.Content.cs:112-115`), where CODESYS pulls the same fact as
  `%EXCLUDE_FROM_BUILD`: the vendors diverge on the wire. How TwinCAT stores a FOLDER's exclusion is unmeasured; the
  walk reads only `<Compile>` entries, so if it is stored on `<Folder>`, items in an excluded TwinCAT folder pull today
  as built ones: wrong data, silently.
- The LSP ignores `%EXCLUDE_FROM_BUILD`. CODESYS does not compile excluded code, and an uncompiled POU has no signature
  (DIALECT C2j), so built code cannot call it. The LSP reports diagnostics in excluded code and resolves built code
  against excluded declarations. That is a bug in today's release, independent of folders.

## What Changes

- **The folder's facts are its descriptor.** A folder whose build property is off its defaults has a read-only
  `<folder path>/<FolderName>.folder` descriptor (a new kind) with the shared build-property layout, `Exclude from build`
  among its rows. `ContainerRefusal` drops the folder case, and with it the walk's held-list branch for excluded
  folders. The descriptor's kind word must differ from `folder`, which `unreadableNodes` already uses for containers.
- **Its items are ordinary items.** They are in `items` with their own texts and only their own properties (their own
  `%EXCLUDE_FROM_BUILD` when set). They are not in `unreadable`, and the push does not refuse them for that reason.
- **Effective exclusion is derived:** an item is excluded when its own flag is set or a folder above it has a descriptor
  stating `Exclude from build`. No text states it twice.
- **TwinCAT, after a live measurement (stop gate):** how TwinCAT stores a folder's and an item's exclusion (on `<Folder>`
  in the `.plcproj`, on `<Compile>`, or elsewhere), and the member that writes an item's. Then: an excluded TwinCAT item
  pulls with `%EXCLUDE_FROM_BUILD`, the push writes it by the measured member, and an excluded TwinCAT folder gets the
  same `.folder` descriptor. If TwinCAT has no folder exclusion, the measurement says so and no TwinCAT `.folder` exists.
- **LSP gate, keyed on effective exclusion:** `.folder` joins `REFERENCE_EXTENSIONS`; an effectively excluded item gets no
  diagnostics, and its declarations leave the scope built code resolves against, so a call from built code to an
  excluded POU is reported as CODESYS reports it. Red tests come from the build-conformance recordings.
- **Completeness oracle:** in `packages/volt-cli/scripts/completeness.known.ts`, only the subjects refused for an excluded
  folder go; every other subject and entry stays.

Rejected: `%EXCLUDE_FROM_BUILD` written on each item of an excluded folder, because a push would then set an item flag
the engineer never set, and moving the item out of the folder would keep it excluded.

## Impact

`Volt.Ide.Codesys` (`ContainerRefusal`, `CodesysDriver.Tree.cs`), `Volt.Ide.Twincat` (`BeckhoffDriver.Content.cs`, the
walk, the `.plcproj` reads), `Volt.Engine` (`ItemKind`, the descriptor layout from `codesys-application-defines-spelled`,
`PushService`), `volt-lsp-iec` (reference scan, diagnostics gate, symbol scope), `scripts/completeness.known.ts`,
`docs/items.html`, `docs/wire.html`, DIALECT.
