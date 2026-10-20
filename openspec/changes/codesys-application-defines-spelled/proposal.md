> Answers the PLC Assist finding of 2026-10-19 (production pull of Pro2193 on 0.1.17884): the `Application` node is in
> `unreadableNodes` because its build property holds `CompilerDefines 'VISU_USEPROPERTYINFO'` ("Volt's text has no line
> for it").
>
> No wire member changes; protocol stays 1: the new item and its kind are content.

## The rule: container descriptors (owner, 2026-10-19)

A container's own facts are a READ-ONLY descriptor item inside the container, named after the node itself, with the
node's own kind. The precedent is the device descriptor `<dev>/<dev>.device` (`Volt.Ide.Codesys/Driver/
CodesysDriver.Tree.cs:77-87`).

- The descriptor exists exactly when the node has a fact to state. Every device has one (its identity), so every
  device has a descriptor. A build property at its defaults states nothing, so an application or folder whose build
  property is at its defaults has no descriptor, just as the `Descriptor` renderer writes no line for an empty value.
- Its body is the shared `Descriptor` renderer (`Volt.Engine/Format/St/Descriptor.cs`), with one build-property layout
  for every container kind that has one: `Compiler defines`, `Undefines`, and each other build flag
  (`Exclude from build`, `Link always`, `External`, `Enable system call`, `Online change reserve`) only when set.
- A push to a descriptor is refused, as for every read-only descriptor.
- Once a fact has a descriptor, the container no longer appears in `unreadableNodes` for it.

## Why

`ContainerRefusal` lists an application's non-empty `CompilerDefines` as a reason
(`Ide/CodesysObjectModel.Properties.cs:162-205`), so the walk names the Application in `unreadableNodes` and walks
everything under it. The defines reach a client only as prose. They decide which `{IF defined(...)}` branches compile,
so a client reading the pulled code cannot tell which branches are live.

TwinCAT holds the same fact per PLC project ("Compiler defines" on its compile page) and spells it today as the
`Project defines` row of that PLC project's `Project Settings.projectsettings` (`Volt.Ide.Twincat/Ide/
TcProjectSettings.cs`). CODESYS uses that row for a different fact: the project's own compile defines. So one row means
two facts, and one fact (an application's defines) has two spellings.

The LSP keeps only the last `.projectsettings` it reads (`packages/volt-lsp-iec/src/workspace/workspace-refs.ts:186-189`).
A TwinCAT solution with several PLC projects has several, and loses all but one.

## What Changes

- **CODESYS:** `<app root>/<AppName>.application`, a new read-only kind, carries the Application's whole build property
  through the shared layout. `ContainerRefusal` drops the Application case.
- **TwinCAT, after a live probe (stop gate):** if the PLC project's "Compiler defines" answer `defined()` in that
  project's code, the same descriptor goes at the PLC project node, the root the walk states in `applications`, named
  after that node. It holds the rows TwinCAT has a source for; the others are absent, never defaulted. The `Project
  defines` row of TwinCAT's `.projectsettings` becomes null (D39: no vendor source). Each fact then has one spelling on
  both vendors. If the probe shows they do not answer `defined()`, stop and report.
- **Kind:** `.application` joins `ItemKind`'s reference kinds and the generated docs tables
  (`packages/volt-cli/docs/items.html`); the wiring check (`bun run check`) stays green.
- **LSP:** `.application` joins `REFERENCE_EXTENSIONS`, and the condition evaluator answers `defined(x)` from the
  `Compiler defines` of the application whose root (`applications`) is the longest prefix of the item's path.
  `project_defined` keeps reading the project's defines.
- **LSP, `.projectsettings` per project:** the settings are kept per PLC project / application instead of last-wins.

Rejected: an `applications` member `[{ root, compilerDefines }]`, because a wire member's shape would change for one
setting, which belongs in text beside the code it decides.

## Impact

`Volt.Ide.Codesys` (`ContainerRefusal`, `CodesysDriver.Tree.cs`, the descriptor read), `Volt.Ide.Twincat` (walk,
`TcProjectSettings`), `Volt.Engine/Item/ItemKind.cs`, `Volt.Engine/Format/St/Descriptor.cs` (the build-property layout),
`volt-lsp-iec` (`workspace-refs.ts`, `condition-eval.ts`), `docs/items.html`, `docs/wire.html`, DIALECT. Corpora with an
application build property gain one file each.
