> Answers the PLC Assist finding of 2026-10-19 (production pull of Pro2193 on 0.1.17884): `unreadableNodes` named
> `Library Manager` TWICE — once for three redirected placeholders no reference names (`L_COM_EPMS640`,
> `MemoryBlockManager`, `NetBaseSrv`), once for 18 library parameter values (`#Analyzation`, `#Util`, …) "whose text form
> Volt has not measured".
>
> No wire member changes; protocol stays 1. Part A changes how many entries one node has; Part B adds `PARAMETER` lines,
> which are manifest content (TwinCAT already writes them).

## Why

**A. One node, two entries.** `GetLibraryRefs` returns one `unspelled` string per kind of thing the manager holds that
no manifest spells (`Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs:96-104`), and the walk adds one
`UnreadableObject` per string, each with the manager's name and folder (`Driver/CodesysDriver.Tree.cs:177-181`). So one
node is listed twice and takes two version slots (`Versioning.CountUnclassifiable`). Every other container joins its
reasons into one entry (`CodesysObjectModel.Properties.cs`, `string.Join(" and ", reasons)`).

**B. Parameter values are counted, not spelled.** CODESYS keeps them as `IExpression`s: from 3.5.19 in the manager's
archived `ParameterTable`, before that in each reference's `Params` (`Libraries.cs:126-163`, DIALECT V7). The manifest
line exists, `PARAMETER <library> <name> := <value>` (`Volt.Engine/Library/LibraryManifest.cs:87-91`), and TwinCAT fills
it from the reference's `ParameterList`; CODESYS passes none. So an IDE edit to a parameter value moves no version on
CODESYS: the count stays the same. A library's `PARAM.*` constants size its arrays and buffers, so the value is code.

## What Changes

- **A. One entry per node.** The Library Manager appears at most once in `unreadableNodes`. Its reasons are joined with
  `" and "` like every other container's, and it has one version slot. The stray redirections (placeholders no
  reference names) are named in that one entry.
- **A gate.** A test, not a runtime check: no node path appears twice as a `folder`-kind entry in any walk result of
  either driver. Two different objects of one name and different kinds stay two entries (CLAUDE.md protocol invariant).
- **B1. CODESYS spells parameter values** as `PARAMETER` lines in the manifest of the library each value belongs to, in
  the vendor's order, byte-identical to TwinCAT's line for the same name and value. A value is then no reason in the
  manager's entry, and an IDE edit to it changes that manifest's version. A value for a library no walked reference
  names has no manifest to stand in, so it stays a reason in the one entry.
- **B1 is gated by a live measurement** (task 1): which `IExpression` member gives exactly the text the Parameters tab
  shows; whether a `ParameterTable` entry's name matches the manifest's `LIBRARY` line; whether a parameter name is
  `PARAM.X` or bare; whether values exist for libraries no walked reference names; the vendor's order. On live SP21, and
  on 3.5.18.30 for the per-reference `Params`.

Rejected: dropping the stray redirections from the wire and naming them in the pull log only, because the wire must not
drop a fact. A `REDIRECT` line in another library's manifest, because that library does not own the redirection.

## Impact

`Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs` (one reason; `ToLibRef` passes `parameters`),
`Driver/CodesysDriver.Tree.cs:177-181`. After B1, every CODESYS library manifest with set parameter values changes bytes
once. DIALECT V7, `docs/wire.html` (the `Library Manager` example).
