> Follows DIALECT C39 (measured 2026-10-19, TcXaeShell 15.0 / TwinCAT 3.1.4024.74, openspec `excluded-folder-items-pulled`
> 1.1). No wire member changes; protocol stays 1.

## Why

Volt decided "excluded from build" on TwinCAT from the SAVED `.plcproj` `<Compile>` entries (`TcObjectModel.CompileEntries`,
refused in `BeckhoffDriver.ReadProperties`). C39 measured three defects that follow:

1. An item in an excluded FOLDER pulls as a built item. The folder's flag is stored on its `<Folder>` entry alone; the
   items' entries do not change. Silently wrong data.
2. A re-included item keeps `<ExcludeFromBuild>false</ExcludeFromBuild>`, and Volt refused every `Compile` child but
   `SubType`, so the item stayed unreadable forever.
3. XAE writes the flag only on save but builds from memory (D45). An unsaved exclusion pulled as built; an unsaved
   re-inclusion stayed unreadable. Volt never saves the IDE, so the saved file is the wrong source.

The source that holds every case, saved or not, is the node's own live `Exclude` VSProperty in `ProduceXml(false)`: own
flag (`True`), or inherited from an excluded folder (`True`, `readonly="true"`). Folders and members publish it too.

## What Changes

- **The live property decides.** `TcObjectModel.Exclusion` reads `Exclude`; the `.plcproj` is no longer read for it, and
  an `<ExcludeFromBuild>` child (any value) no longer refuses the item. Other `Compile` children are still refused by name.
- **Own exclusion is `%EXCLUDE_FROM_BUILD`**, as on CODESYS — on an item and on a member. A push writes the flag through
  `ConsumeXml` of that one property and reads it back. A push carrying the line on both a POU and its member is refused
  by name: TwinCAT shows a member of an excluded POU as inherited, with no flag of its own.
- **An excluded folder is answered as CODESYS answers one** (`Volt.Engine/Ide/ExcludedFolder`, shared by both walks):
  the folder in `unreadableNodes`, every item under it in `unreadable` ("sits in the excluded folder …"), ops on them
  refused. The `.folder` descriptor of `excluded-folder-items-pulled` replaces this on both vendors together.
- **Folder wins:** an object with its own flag inside an excluded folder reads `readonly` too, and is treated as inherited
  (unmeasured beyond that read; stated in C39).

## Impact

`Volt.Ide.Twincat/Ide/TcObjectModel.Properties.cs`, `Driver/BeckhoffDriver.Content.cs`, `Driver/BeckhoffDriver.Tree.cs`;
`Volt.Engine/Ide/ExcludedFolder.cs` (new, both walks); `Volt.Ide.Codesys` uses it (wording unchanged); DIALECT C39;
`docs/items.html`, `docs/wire.html`, `docs/logs.html`; offline tests `TcExclusionTests` and CODESYS parity cases; the e2e
one-to-one TwinCAT block.
