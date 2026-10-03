## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our tool census observed, and
our reading of volt's code to explain it. The observations are recorded facts. The explanation and the requested change
are our interpretation, and may be wrong — about the cause, about whether it is a gap at all, or about volt's intent.

Before any work: verify the observation, then confirm or refute our reading. If the behaviour is intended, already
covered by another route, or the gap is ours (the client using the wire wrongly), record that here with the reason and
stop — that answer is as useful to us as a fix. Only a confirmed real gap that fits volt's design goes on to the tasks.

## Why

**A client that reads one library by name gets its manifest and nothing it can call.** It cannot learn a function
block's pins from the bridge without a full fetch that renders every signature of every referenced library.

Recorded by the PLCAssist tool census, 2026-10-03, CODESYS 3.5.21.40, next bridge on volt `457b6a700b`
(case R6, `census-2026-10-03T14-40-45` small fixture and `census-2026-10-03T14-45-47` Pro2193):

- PLCAssist's `plcRead` asks for one library: `fetch { onlyItems: ["Standard, 3.5.17.0 (System).library"] }`.
- The answer is the manifest alone: `LIBRARY`, `NAMESPACE`, `RESOLUTION`, `PLACEHOLDER`, `SYSTEM`, `DEPENDENCIES`,
  `MATERIALIZATION 4` (531 characters). It names no TON, no CAA FB and no pin.
- The model needs the pins of a library FB (`TON`, a CAA `xExecute`/`xDone`/`xError` block) to write a call that
  compiles. It cannot get them from the tool, so it guesses or searches the web.

What the code shows (volt `457b6a700b`):
- `FetchService.cs:210`: `librariesRefreshed = onlyItems == null && …`. A directed fetch never refreshes libraries.
- `FetchService.cs:225-236`: signatures are extracted (`ide.ExtractLibrarySignatures()`) only when
  `librariesRefreshed`, and then for EVERY referenced library (5,220-5,406 signatures on real corpora,
  `CodesysObjectModel.Libraries.cs:156-168`; the precompile is a `Build(app)`).
- `DriverBase.cs:140-145`: TwinCAT returns no signatures at all.
- `LibraryManifest.cs:28-47, 66`: `MATERIALIZATION` is the workspace-format marker the LSP reads. It describes how a
  pull wrote the workspace, not the library, and means nothing to a client that does not keep a workspace.

So the only way to get one FB's pins is a full fetch of the whole project plus every library's API. A client that
reads items one at a time has no route.

## Gate: only where it matches volt's design

This is what PLCAssist NEEDS, not a design handed to volt. Before implementing any part, check it against volt's own
design: the directed-preview contract of `onlyItems` (FetchService.cs:44-49, :249-258: nothing outside the subset is
"removed"), the per-version immutability the signature path already relies on (archived `cache-library-signatures`),
the precompile cost, and the CLI's read-only library folders. Implement only the parts that fit. For a part that does
not, record why and what volt-native route gives a client the same thing (one library element's signature, on
demand), and leave it for the owner.

## What Changes

- **A directed fetch can return a library's signatures.** Either:
  - (A) a fetch whose `onlyItems` names `X.library` also returns X's signature items (the same rendered files a full
    fetch writes under X's folder); or
  - (B) a new op, `librarySignatures { library, names? }`, that returns X's signature items, filtered to `names` when
    given (e.g. `["TON", "TOF"]`).
  (B) keeps `onlyItems` exactly as it is today. Which one fits is the gate's question.
- **Cost bounded per library version.** A library's API is fixed per `RESOLUTION`, so the extraction is cached per
  resolution, and the precompile runs at most once per session for a set of resolutions (the archived
  `cache-library-signatures` already states the invariant).
- **Optional:** leave the `MATERIALIZATION` line out of a manifest returned by a directed fetch, or move it out of the
  manifest body, since it describes the workspace, not the library. Only if the LSP's format check does not need it
  there.
- **TwinCAT:** out of scope until TwinCAT has signatures; the op answers empty there, or the field says so.

## Impact

- `Volt.Engine/Sync/FetchService.cs` (the `librariesRefreshed` decision, or a new op handler), `Volt.Engine/Library/
  LibraryFetch.cs`, the CODESYS driver's extraction, `Volt.Contracts/Wire/RefsFetch.cs` (or a new request type),
  regenerated `docs/volt-bridge.openrpc.json`.
- Clients: PLCAssist's `plcRead` would return signatures for a `.library` read, and its description would say so.
  Until then PLCAssist says a `.library` reads as its manifest only.

## Volt's assessment and plan (2026-10-03, owner + volt)

**Observation confirmed; the reading is mostly right; one claim is wrong.**

- Confirmed: `FetchService.cs:210` — `librariesRefreshed = onlyItems == null && …`. A directed fetch never refreshes
  libraries, so `fetch { onlyItems: ["X.library"] }` answers the manifest alone.
- How `volt pull` gets the signatures today: a FULL fetch (no `onlyItems`) on init, or when a `.library` version
  differs from the client's `knownItems`, calls `ide.ExtractLibrarySignatures()` once for every referenced library and
  renders each signature as a read-only item written beside its `.library` (`LibraryFetch.AppendLibrarySignatures`).
  A library's API is immutable per version, so an unchanged library is not re-extracted.
- **Wrong:** "TwinCAT returns no signatures at all". `BeckhoffDriver.ExtractLibrarySignatures()` overrides the base
  and returns `_ITcPlcLibraryManager.ProduceAllLibrarySignatures()` parsed by `TcLibrarySignatures.cs`. The comment on
  `DriverBase.ExtractLibrarySignatures` ("TwinCAT has no library signatures yet") is stale and misled you; it is fixed
  in this change. So the route works on BOTH vendors (volt's rule: both vendors answer identically on the wire).

**Owner decision: route (A), no new op.** A `.library` is an item like any other extension: reading it returns
everything that item holds, i.e. the manifest AND all its signatures, exactly what a full fetch writes beside it.
There is no reason to treat `.library` differently from other extensions. `onlyItems`'s contract ("nothing outside
the subset is removed") is unchanged: the signature items belong to the library that was named.
- No element filter (`names`) — the library's full API comes back; a client keeps what it needs. (Owner: "a fetch for
  `.library` should just return all signatures".)
- Cost: the extraction (a precompile on CODESYS) is cached per library `RESOLUTION` in the session, so repeated reads
  cost one extraction. Measured before/after in 1.2.
- `MATERIALIZATION`: stays in the manifest unless the LSP's format check (`LibraryManifest.cs:28-47`) is proven not
  to need it — a cosmetic point, not part of the gap.

**Extended (owner): prove that EVERY readable extension is actually readable by a directed fetch.** This gap existed
because `.library` was special-cased without a test that would have caught it. New tasks 2.4 / 4.3: for every
extension in `ItemKind` that a fetch can return (source items, descriptors, libraries, devices, tasks, …), a directed
`fetch { onlyItems: [X.ext] }` returns the same content for X as a full fetch — on both vendors, live, data-driven over
`ItemKind` so a new kind without a row fails.

Order: runs in volt's bridge lane after `bridge-refusal-review` (it touches the same fetch/push code).
