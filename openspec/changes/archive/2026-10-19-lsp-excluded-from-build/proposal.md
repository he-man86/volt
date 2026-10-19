> Answers the review finding in `excluded-folder-items-pulled` (proposal, Why, last bullet): the LSP ignores
> `%EXCLUDE_FROM_BUILD`. That is a bug in today's release, independent of folders, so it is taken out as its own change.
>
> `packages/volt-lsp-iec` only. No wire change. The folder half stays in `excluded-folder-items-pulled`, which adds it to
> the one function this change introduces.

## Why

- `object-properties.ts` reads `%EXCLUDE_FROM_BUILD` as an object property and keeps the line for the formatter.
  Nothing in `src/analysis` reads it. An object excluded from build is analysed as built code.
- CODESYS does not compile an excluded object: it has no signature in any precompile context (DIALECT C2j, live SP21 on
  a Pro2193 copy: 9 POUs with no signature, 4 flagged `exclude_from_build`, 5 excluded by a folder).
- Measured on the corpus (2026-10-19): 12 objects carry their own `%EXCLUDE_FROM_BUILD`. In pro2193 there are 7
  methods, 2 FBs, 1 PROGRAM and the `CheckPointer` check function; in lenze-mid there is 1 FBD PROGRAM. Both recorded
  builds are complete and clean (pro2193: 7 warnings; lenze-mid: 6), and none of their diagnostics is in an excluded
  object. Today the LSP shows nothing there too, but only because the identifier-scan reachability finds all 12 dead.
  With `diagnoseDeadCode` on, the same objects give 370 findings in pro2193 (`C0046`, `C0004`, …) and 8 network
  findings in lenze-mid (`Expression expected instead of '?'`). The build has none of them. An excluded method whose
  name matches an interface method, or an excluded POU that built code names, is never dead, and it gives the same
  false findings with the default settings.
- The identifier scan also counts the references inside excluded code. An FB that only excluded code uses stays live,
  but the compiler sees no call to it.

## What Changes

- **One function decides exclusion:** `effectivelyExcluded(parseResult)` in `analysis/reachability/exclusion.ts`.
  An object is excluded when its own `%EXCLUDE_FROM_BUILD` is set or an object above it in the IDE tree is excluded. A
  file's own object (POU, DUT, GVL, interface) excluded means the whole file, members included. Otherwise each member
  that carries the flag is excluded (method, action, property, interface member; an accessor has no property lines).
  `excluded-folder-items-pulled` adds "or a folder above it has a `.folder` descriptor stating `Exclude from build`" here and nowhere else.
- **An excluded object gives nothing, as a dead POU gives nothing** (`pipeline/document.ts`): parse errors, semantic
  and network findings, with or without `diagnoseDeadCode`. The missing-language finding stays, because it follows the
  push and not the build.
- **Excluded code is no reachability edge** (`reachability.ts` `fileReachInfo`): its identifiers are not refs, and an
  excluded PROGRAM is no root.

Not in this change: the scope half. "Its declarations leave the scope built code resolves against, so a reference from
built code is reported as CODESYS reports it" needs a recording of a built POU that references an excluded one. No
fixture or corpus recording has one: every reference to an excluded object in the corpus is in a comment or in excluded
code, which is why both builds are clean. Recording it needs a live CODESYS. The step stays in
`excluded-folder-items-pulled` (its task 4), with that recording.

## Impact

`packages/volt-lsp-iec`: `src/analysis/reachability/exclusion.ts` (new), `reachability.ts`, `pipeline/document.ts`,
the analysis barrel, `test/corpus/corpus-diagnostics.test.ts` (the oracle case) and its support pass, `docs/architecture.md`.
