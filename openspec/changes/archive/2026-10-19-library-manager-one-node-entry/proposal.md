> Answers the PLC Assist finding of 2026-10-19 (production pull of Pro2193 on 0.1.17884): `unreadableNodes` named
> `Library Manager` TWICE — once for three redirected placeholders no reference names (`L_COM_EPMS640`,
> `MemoryBlockManager`, `NetBaseSrv`), once for 18 library parameter values (`#Analyzation`, `#Util`, …) "whose text form
> Volt has not measured".
>
> No wire member changes; protocol stays 1. This change makes the node one entry; spelling the parameter values is
> `codesys-library-parameters-spelled`.

## Why

**One node, two entries.** `GetLibraryRefs` returns one `unspelled` string per kind of thing the manager holds that
no manifest spells (`Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs:96-104`), and the walk adds one
`UnreadableObject` per string, each with the manager's name and folder (`Driver/CodesysDriver.Tree.cs:177-181`). So one
node is listed twice and takes two version slots (`Versioning.CountUnclassifiable`). Every other container joins its
reasons into one entry (`CodesysObjectModel.Properties.cs`, `string.Join(" and ", reasons)`).

## What Changes

- **One entry per node.** The Library Manager appears at most once in `unreadableNodes`. Its reasons are joined with
  `" and "` like every other container's, and it has one version slot. The stray redirections (placeholders no
  reference names) are named in that one entry.
- **A gate.** A test, not a runtime check: no node path appears twice as a `folder`-kind entry in any walk result of
  either driver. Two different objects of one name and different kinds stay two entries (CLAUDE.md protocol invariant).

Rejected: dropping the stray redirections from the wire and naming them in the pull log only, because the wire must not
drop a fact.

## Impact

`Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs` (one reason),
`Driver/CodesysDriver.Tree.cs:177-181`.
