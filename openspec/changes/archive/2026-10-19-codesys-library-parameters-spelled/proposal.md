> Split out of `library-manager-one-node-entry` (archived 2026-10-19), which made the Library Manager one
> `unreadableNodes` entry. Answers the second half of the PLC Assist finding of 2026-10-19: 18 library parameter values
> "whose text form Volt has not measured". No wire member changes; protocol stays 1 (`PARAMETER` lines are manifest
> content, TwinCAT already writes them).

## Why

**Parameter values are counted, not spelled.** CODESYS keeps them as `IExpression`s: from 3.5.19 in the manager's
archived `ParameterTable`, before that in each reference's `Params` (`Libraries.cs:126-163`, DIALECT V7). The manifest
line exists, `PARAMETER <library> <name> := <value>` (`Volt.Engine/Library/LibraryManifest.cs:87-91`), and TwinCAT fills
it from the reference's `ParameterList`; CODESYS passes none. So an IDE edit to a parameter value moves no version on
CODESYS: the count stays the same. A library's `PARAM.*` constants size its arrays and buffers, so the value is code.

## What Changes

- **CODESYS spells parameter values** as `PARAMETER` lines in the manifest of the library each value belongs to, in
  the vendor's order, byte-identical to TwinCAT's line for the same name and value. A value is then no reason in the
  manager's entry, and an IDE edit to it changes that manifest's version. A value for a library no walked reference
  names has no manifest to stand in, so it stays a reason in the one entry.
- **Gated by a live measurement** (task 1): which `IExpression` member gives exactly the text the Parameters tab
  shows; whether a `ParameterTable` entry's name matches the manifest's `LIBRARY` line; whether a parameter name is
  `PARAM.X` or bare; whether values exist for libraries no walked reference names; the vendor's order. On live SP21, and
  on 3.5.18.30 for the per-reference `Params`.

Rejected: a `REDIRECT` line in another library's manifest for a stray redirection, because that library does not own it.

## Impact

`Volt.Ide.Codesys/Ide/CodesysObjectModel.Libraries.cs` (`ToLibRef` passes `parameters`). Every CODESYS library manifest
with set parameter values changes bytes once. DIALECT V7, `docs/wire.html` (the `Library Manager` example).
