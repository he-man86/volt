## Why

After the exclude-from-build, standard-function, and reserved-keyword wins, built-only LSP precision on
pro2193 is **1097 diagnostics — and ~1066 of them are one thing: un-mirrored library symbols**
(`PACK_ML`, `L_MC1P`/`L_MC4P` motion, `SER_*`, `IQSlices`, `Fanuc_*`, `Cmp*`, `Str*A`). `volt pull` mirrors
project source only; referenced libraries live outside the repo, so the LSP can't resolve their types/FBs
and flags every reference. There's no ground truth to fix in the resolver — the symbols genuinely aren't
in what we mirror.

A **live spike (2026-07-02, since reverted) proved we can extract them.** The referenced libraries'
resolved signatures are reachable in-process through the same .NET automation the bridge already
reflects over: build the project, then `LanguageModelMgr.GetCompileContext(appGuid).GetAllSignaturesFlat()`
returns the **complete resolved symbol table** — 16,424 signatures for pro2193, project *and* every
library, including the exact offenders (`L_MC4P_PARAMETERINDEX`, `L_MC4P_AXESGROUP_STATE`, …). Each is an
`ISignature2` we can render to ST declaration text via `GetConverterToIEC`. So we can mirror each
library's public interface into the repo as signature stubs the LSP ingests.

## What Changes

Mirror each referenced library into the repo as **read-only signature files** — one file per public
library element, declaration/signature only (no bodies), using the same kind-based extensions as project
source (`.fb`/`.prg`/`.fun`/`.struct`/`.enum`/`.union`/`.alias`/`.gvl`/`.itf`), organized by library
namespace under a dedicated read-only `libs/` tree (e.g. `libs/L_MC4P/L_MC4P_AxesGroup.struct`,
`libs/PACK_ML/State.enum`). The LSP ingests `libs/` into an ambient library scope so qualified and bare
references to library symbols resolve — clearing the ~1066-diagnostic floor and enabling real hover /
completion / go-to-definition on library symbols.

**Key efficiency (user's insight):** library signatures are immutable for a given library *version*, so
extraction is **keyed and cached per library-version, not per project state** — a normal pull skips the
expensive build+extract entirely; only added/removed/version-bumped libraries re-extract. This makes the
`libs/` tree stable and diffable, and sidesteps the ~25–35 s build cost on every fetch.

## Capabilities

### New Capabilities
- `library-signature-index`: the bridge extracts referenced-library signatures (build → compile-context →
  render), the CLI materializes them into a read-only `libs/` tree keyed by library version, and the LSP
  resolves library symbols through them.

### Modified Capabilities
- `bridge-protocol`: a new library-signature extraction step/endpoint, versioned per library so the wire
  ships only changed libraries.
- `language-server`: the LSP SHALL resolve identifiers against an ambient library scope built from the
  `libs/` tree (in addition to project scope); the hand-curated standard-function table becomes a
  fallback/stopgap, largely superseded.
- `workspace-file-extensions`: the read-only `libs/` tree uses the kind-based extensions but is never a
  push target.

## Impact

- **Code:** `packages/volt-bridge` (signature extraction via `LanguageModelMgr` +
  `GetCompileContext`/`GetAllSignaturesFlat`/`GetConverterToIEC`; a per-library-versioned wire endpoint;
  Beckhoff returns none initially), `packages/volt-git` + `packages/volt-control` (materialize `libs/` +
  a library-version manifest; incremental refresh), `packages/volt-lsp-codesys` (ingest the library
  scope; scan `libs/` read-only; reduce `standard-functions.ts`), `packages/volt-vscode` (mark `libs/`
  read-only, optional `LIB` badge).
- **Repo:** a new top-level read-only `libs/` tree (committed, versioned by a library manifest hash).
- **Cost:** extraction requires a build (~25–35 s on pro2193), amortized by per-library-version caching —
  paid only when a library changes, not per pull.
- **Supersedes:** the `standard-functions.ts` stopgap (the CODESYS Standard/String libraries are
  themselves indexed libraries). Mirrors the archived `exclude-from-build-awareness` cross-layer shape.
