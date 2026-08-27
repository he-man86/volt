## 0. Baseline — the gate every step below compares to

Measured 2026-08-27, immediately before this change:

- offline `Volt.Engine.Tests` **680** / `Volt.Cli.Tests` **142** / `Volt.Cli.Connector.Tests` **80** /
  `Volt.Cli.Ide.Twincat.Tests` **3**
- live CODESYS e2e **129 pass / 20 skip / 0 fail**, 26 files
- `bun run check` green, 2 `[UNMEASURED:]` markers enumerable; `bun run lint` 0 errors

**A move that changes any of these numbers is a bug in the move**, not a result. That is the whole gate: this
change may not fix anything, break anything, or make any test newly pass.

## 1. Kill "VG" first — smallest, and it makes the move's diff readable

Done before the move so the two never appear in one diff: a rename inside a relocation is unreviewable.

- [x] 1.0 **Three PRODUCTION identifiers, which this plan said did not exist:** `GraphRoundTrip.ToVg` →
      `ToNetworkText`, and the locals `childVg` / `pouVg` → `childIsNetwork` / `pouIsNetwork`. Found by the
      compiler after the test rename; the original count came from a `vg` grep that cannot match a camelCase
      compound. Corrected in `proposal.md` rather than quietly fixed.
- [x] 1.1 **Test identifiers.** `vg_*` fixture prefixes and `Vg_*` / `_vg_` method names across
      `Volt.Engine.Tests` and `test/e2e` become `net_*` / `Network_*`. Roughly 30 identifiers; the compiler and
      the e2e run find every miss.
- [x] 1.2 **`VG_KEYWORDS`** in `test/e2e/harness.ts` → `NETWORK_KEYWORDS`.
- [x] 1.3 **Prose.** ~200 doc-comment mentions across the test suite, 4 in `CLAUDE.md`, plus
      `docs/network-text.md` and `docs/network-text-diagnostics.md` (whose FILENAMES are already right — only the
      body text says VG). Replace with "network text".
- [x] 1.4 **Leave `openspec/changes/archive/` and closed change folders alone.** A frozen record that gets
      rewritten stops being evidence.
- [x] 1.5 Gate: all four offline suites at the §0 baseline; e2e green. No behaviour touched.

## 2. The move — one folder per commit, so a bisect lands on a folder

Order chosen so each step compiles on its own: leaves first, then the things that depend on them.

- [x] 2.1 **`Item/`** ← `Vocabulary/ItemKind.cs`, `Vocabulary/FolderPath.cs`, `Model/WorkspaceItem.cs`,
      `Ide/ItemRef.cs`, `Ide/ProjectItem.cs`, `Ide/WalkResult.cs`. **DONE.**
      **Two of the nine planned files were mis-assigned, and the compiler said so:**
      - `TreeNav.cs` and `ItemLookup.cs` take `IIdeDriver` / `IProjectTree`. They navigate an IDE's project tree —
        driver machinery, not item identity — so they stayed in `Ide/`.
      - `ProjectSnapshot.cs` needs `Hasher`: it computes the version snapshot `refs` answers with. That is an
        OPERATION, so it stays with them (→ `Ops/` in 2.6).
      The test for "does this belong here" turned out to be mechanical: **if a file needs a `using` for a layer
      above it, it is in the wrong folder.** Both were caught by a failed build, not by review.
- [x] 2.2 **`Source/Body/St/`** ← the whole of `Text/`, plus `Vocabulary/CodeHelper.cs` (it parses an ST header
      line, which is ST reading, not vocabulary). **DONE.**
- [x] 2.3 **`Source/Body/Network/`** ← the whole of `Graph/`, plus `Model/GraphModel.cs`. **DONE.**
      Three mechanical hazards worth knowing before 2.4–2.8, all found the hard way:
      - **Block-scoped namespaces need a CRLF-aware anchor.** `^namespace X$` does not match `namespace X`, so
        three files silently kept the old namespace and the build failed two steps later.
      - **Adding a `using` is not enough — a STALE one must be rewritten.** `using Volt.Engine.Graph;` produced
        CS0234, which the using-fixer does not match at all. Rewrite old namespace names across `src` and `test`
        first, THEN let the fixer add what is missing.
      - **Bare qualifiers that resolved through the namespace hierarchy break.** `Graph.NetworkText.LanguageOf(…)`
        worked from inside `Volt.Engine.*` and stops working once the target moves. Drop the prefix.
- [x] 2.4 **`Source/Body/`** ← `BodyCodec.cs`, `BodyElement.cs`, `BodyGuard.cs`, `BodySpliceGuard.cs`,
      `Vocabulary/BodyMarker.cs`, `Vocabulary/Languages.cs`, `Sync/BodyFormatGuard.cs`.
- [x] 2.5 **`Source/`** ← `PlcOpenDocument.cs`, `PouReader.cs`, `PouSplice.cs`, `Declaration.cs`,
      `ProjectStructure.cs`, `PouDocument.cs`, `Model/ItemContent.cs`, `Vocabulary/Namespaces.cs`, **and
      `DIALECT.md`**.
      ⚠ `scripts/check-wiring.ts:263` hardcodes `src/Volt.Engine/Document/DIALECT.md`. Update it in THIS commit —
      `bun run check` is the thing that catches it, and it must not be red between commits. **DONE** (two lines:
      the read at `:263` and the prose at `:234`).
      `LibSignature.cs` also moved here, to `Library/`, which is what emptied `Model/`.
- [x] 2.6 **`Ops/` — PROPOSED AND REJECTED; `Sync/` keeps its name.** `Volt.Engine.Ops` collides with
      `Volt.Contracts.Ops`, the wire op-code vocabulary: `ProjectSnapshot`'s `operation = Ops.Refs` silently
      resolved to the new namespace and stopped compiling. The rename was reverted rather than worked around with
      a fully-qualified name — `Sync` is accurate (this IS the sync engine) and collision-free, and renaming a
      thing to a synonym that collides is a cost with no benefit. The §Why critique of `Sync/` — that it mixes the
      operations with the machinery they are built from — stands, and is a separate change if it is worth making
      at all: eleven files is not obviously enough to sub-divide.
      Files that would have moved ← `PushService.cs`, `FetchService.cs`, `RefsService.cs`, `BuildService.cs`,
      `Materializer.cs`, `Hasher.cs`, `Versioning.cs`, `OpGuard.cs`, `PushConflicts.cs`.
- [x] 2.7 **`Ide/`** keeps the contract and the driver machinery: `IIdeDriver`, `IIdeSession`, `ICodeStore`,
      `IProjectTree`, `DriverBase`, `BridgeLog`. `Vocabulary/` and `Model/` are now EMPTY and are deleted — if
      either still holds a file, the file was mis-assigned above and belongs to a subject, not to a level.
- [x] 2.8 **Root: `BridgeException.cs` STAYS at the root**, with `Polyfills.cs`. Moving it was planned and
      reverted on sight: its namespace is `Volt.Engine` (the root) because every layer throws it and it is meant to
      be reachable without a `using`. A file in `Ide/` whose namespace says root is worse than a root file — the
      folder would contradict the namespace, which is the exact confusion this change exists to remove.
      Planned but not done: `BridgeException.cs` → `Ide/` (every thrower is a driver or an op reporting a driver
      failure). `Polyfills.cs` stays at the root — it is a compiler shim, not a subject.

Each of 2.1–2.8: `git mv`, fix `namespace` + `using`, build, run all four suites, commit. **No edit that is not
a namespace line.** A behaviour change smuggled into a move is exactly what makes a move unreviewable.

## 3. What the move must NOT do

- [x] 3.1 **No file in `WireVocabularyGuardTests`' exemption set is RENAMED** — it keys on bare filenames, so
      moving is free and renaming breaks the build. Guarded: `ItemKind.cs`, `PlcOpenDocument.cs`, `PouReader.cs`,
      `PouSplice.cs`, `ProjectStructure.cs`, `NetworkTextReader.cs`.
- [x] 3.2 **No new assembly.** `Volt.Engine` stays one `netstandard2.0` project.
- [x] 3.3 **No visibility widened to make a move work.** If a type must go public to sit in its new folder, the
      folder is wrong. (`internal` + `InternalsVisibleTo` already covers the test project.)
- [x] 3.4 **No test edited except its `using` lines.** A move that needs a test changed is not a move.

## 4. Close-out

- [x] 4.1 Final gate: the §0 numbers, exactly. `bun run check` green with the DIALECT path updated; `bun run lint`
      0 errors; live CODESYS e2e 129/20/0.
- [x] 4.2 `packages/volt-cli/ARCHITECTURE.md` — the layer stack section names the old folders. Rewrite it to the
      new shape, and state the rule it now follows: **folders are named for their subject; a body language's
      implementation lives under the body.**
- [x] 4.3 Record the rename in this folder — including anything that turned out to be mis-assigned in §2 and had
      to move twice. That is the useful half of the record; `restructure-plcopen-layer` was closed without one and
      the NEXT rename inherited none of its discipline (see its §9 note).
- [x] 4.4 **Add the mechanical gate that change's close-out lacked:** a grep for the old namespace names
      (`Volt.Engine.Vocabulary`, `.Model`, `.Text`, `.Graph`, `.Document`, `.Sync`) across `src`, `test`, `docs`
      and `ARCHITECTURE.md`, run as part of the close-out. Two renames have now drifted for want of exactly this.
