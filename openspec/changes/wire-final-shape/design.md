# Design: the wire's final shape

Read this table by table. Every row is before → after, the principle it follows, the evidence, and what a client
changes. Nothing here is built until the owner has read it.

## Principles

| | Principle | Why |
|---|---|---|
| **A** | **One fact, one spelling.** An item path is `name`; "no version" is absence; a code is a code. | Two spellings of one fact is where a second client goes wrong (foreign-client review F6, F7, F23). |
| **B** | **A vocabulary is data from the declarations.** The schema's enums and `health`'s catalog come from the hosts' registries. | The rework made a process's catalog its host's declaration (`Volt.Engine/Seam`); the wire still hard-codes two vendors (W1/W2). |
| **C** | **A fact the IDE does not state is absent, never filled.** | Zero-fallback policy (owner, 2026-10-23). |
| **D** | **Every request states its protocol; the bridge refuses another.** | Today only a polite client checks (P4). |
| **E** | **An answer is enough to act on.** A push receipt updates a baseline; a conflict names its op. | F9, F16. |
| **F** | **The schema carries every promise the prose makes; the prose carries current behaviour only.** | F3–F6, F24, F34. |

**Protocol: 2.** One bump. There is no negotiation and no compatibility path: a request without `protocol: 2` is
refused, and PLC Assist moves to protocol 2 in one step.

The foreign-client review was re-run for this design on 2026-10-24 against `wire.html` and the OpenRPC document at
`060bdfb0ee`. It was NOT blind (the reviewer had repo context; a fork cannot spawn a sub-agent), so task 1.1 runs it
blind once more against the drafted shape. Its new findings are marked **R**; the rest trace to
`archive/2026-10-24-volt-cli-rework/input/foreign-client-review.md` (F-numbers) and `map-and-rating.md` (W/P).

## 1. Envelope and frames

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `{op, body}`; the protocol only on `health` | `{op, protocol, body}`, `protocol` required | D · P4: `health.protocol` is the only carrier; the mixed-version refusal is client-side only | send `"protocol": 2` on every request |
| a client of another protocol is served | error frame **`PROTOCOL_MISMATCH`**, naming both numbers, before the body is read | D | upgrade, no retry |
| `body` absent / `{}` / `null` unstated (F2) | `body` absent ≡ `{}`; `null` is `BAD_REQUEST` (already true for members) | A | none |
| connection lifetime unstated (F2) | stated: requests on one connection are sequential; a new one only after the terminal frame; concurrent requests use separate connections | F | none (states current behaviour) |
| `ProgressFrame` not in the OpenRPC; `phase` only in prose (F29, **R**) | `ProgressFrame` schema in the document: `phase` enum `walking`/`reading`, `phaseIndex` 0-based, `total` absent = indeterminate | F | none |
| encoding unstated (F26) | stated: UTF-8 without BOM, frames end in `\n` (task 1.2 measures it first) | F | none |
| `info.version` `"1"` vs `protocol` integer (F15) | both `2` | A | none |

## 2. `health`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `networkText: boolean` | **`languages: string[]`**: every language this bridge shows as `IMPLEMENTATION <LANG>` (the `LanguageRegistry`'s shown set; today `ST`, `LD`, `FBD` on both) | B · `HealthResponse.cs:39`; the flag only fits CODESYS-family graphics (W4/W5) | show a body as editable only if its language is listed |
| kinds only behind a link to `items.html` (F13) | **`kinds: [{ extension, writable }]`** from this bridge's `KindRegistry` | B · a process's catalog is its host's declaration (rework F3) | read kinds from `health` instead of hard-coding them |
| `ProjectEntry.vendor`, `status` bare strings (F3) | enums in the schema, generated from `VendorRegistry` and the status set | B | none |
| `ProjectEntry.dirty: boolean`, required; an unanswered IDE reads `false` | **`dirty` optional: absent when the IDE does not answer** | C · `CodesysObjectModel.cs:65` (`is bool b && b`), `BeckhoffDriver.cs:169,181` (`servedDirty ?? false`) | treat absent as "unknown", never as clean |
| `ProjectEntry.version` undefined (F28) | defined in one line (the IDE's version for that row) or deleted if nothing sets it (task 2.3 measures) | F | none, or drop it |
| `HealthResponse.status` in prose, not in the schema (F4) | **deleted from the prose**: serving = some row's `status` is not `idle` | A · not in `HealthResponse.cs` | none |
| "a `health` with no `ops` is a bridge from before the list" | deleted | F · no older bridges are supported | none |

## 3. `connect` / `disconnect`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| result `{ ok?: boolean }`; a refusal is a frame, so `ok` is never false (F28) | result `{}` | A | stop reading `ok` |
| `x-errorCodes` omit `BAD_REQUEST` (F5), though unknown members are refused since 2.4 | the common set (section 7) applies | F | none |
| project name compared `Ordinal`, paths ignoring case (P3) | **compared like a path: ordinal, ignoring case** — on `connect.project` and `expectedProjectName` | A · `OpGuard.cs:55`, `BridgePipeHost.cs:179`; task 2.4 first measures whether TwinCAT can hold two PLC projects that differ only by case (CODESYS: a file name, so no) | none, unless a client relied on a case mismatch being refused |

## 4. `refs` / `fetch`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `refs.summary`: "its folder, and the aggregate project/structure versions" (F33) | "the path → version map and `projectVersion`" | F · `RefsResponse` has neither field | none |
| `UnreadableItem { name, reason }`: no code, so a client parses the reason (F24) | **`{ name, code, reason }`**, `code` from the code table (`UNREADABLE`, `UNSUPPORTED`, …) | A, F | match `code` |
| `UnreadableNode { name, reason }` | `{ name, code, reason }` | A | match `code` |
| `knownApplications` optional; omitting it beside `knownItems` silently judges unwalked paths differently (F22) | **required when `knownItems` is sent**: else `BAD_REQUEST` naming it | C · a missing baseline fact is not guessed | always send it with `knownItems` |
| `fetch` combinations unstated (F21) | one combination table in `wire.html` (`init` / `knownItems` / `onlyItems` / `libraryManifestOnly`) and the meaning of `librariesRefreshed` | F | none |
| `FetchedItem.unsupported[].language` a bare string | enum: the declared languages, shown or hidden | B | none |

## 5. `push`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `accepted: boolean`, plus "every op the conflicts do not name landed", plus `accepted:false` when the first op only partly landed (F8) | **`accepted` deleted.** One rule: every op `conflicts` does not name landed in full; every op after a refused one is `NOT_ATTEMPTED`, on every answer | A · two fields said one thing, and disagreed on a partial first op | landed = sent ops − conflict names |
| the lease refusal: `accepted:false` with a synthetic conflict row named `<project>` and `currentProjectVersion` | **error frame `STALE_PROJECT_VERSION`**, its message naming the IDE's current version; `currentProjectVersion` deleted | A, E · a conflict names an op, and the lease is no op | pull, then push again (unchanged action) |
| receipt `newItems` (meaning unstated), no `removed` (F9) | `newItems` = the new version of every path the push created or changed; **`removed` = every path the push made disappear** (deletes, rename and move sources) | E | update the baseline from the receipt; no second `refs` |
| `PushConflict.code` optional in the schema, "every conflict carries one" in prose (F6) | **`code` required**, an enum of the conflict codes plus the `NETWORK_` prefix | A, F | drop the `?? fallback` branch |
| ITEM_EXISTS's conflict may name the OTHER item (F16) | `name` is always the op's `name`; the colliding item in **`existing`** | E | map conflicts to ops by `name` |
| `ifVersion: null` and `currentVersion is null` in prose; the schema has no null (F7, F23) | absence everywhere; the prose says "no `ifVersion`" | A | send no `ifVersion` for a create |
| `set` "applied atomically" vs `renamedTo` after a refused set (F19) | wording: "one op, one conflict"; `renamedTo` says where a refused set left the item | F | none |
| `unwalkedFolders` on a push answer: meaning unstated (F9) | defined: the folders the pre-apply walk could not read (their items answered `ITEM_UNVERIFIED`) | F | none |
| `returnSources` / `newSources`: no prose (F9) | defined: with `returnSources`, `newSources` holds the text a `fetch` would now return for every path in `newItems` (our CLI does not send it; PLC Assist may) | F | none |

## 6. `build`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| an unrecognised vendor severity word becomes `info` | **`severity` absent** when the vendor's word is not in the host's declared word table | C · `BuildModels.cs:30-40` | treat absent as "not classified"; `success` is unaffected |
| `line`/`column` required; `0` when the vendor states no position | **optional, 1-based, absent when the vendor states none** | C · `TcObjectModel.Build.cs:192` (`Line = 0`), the CODESYS recording carries `line: 0` | test for presence, not for 0 |
| `duration` without a unit (F25) | **`durationMs`** | A | rename |
| `success` from a different vendor signal on each (F25) | unchanged in this change; task 2.6 measures whether both vendors' signals agree with "no `error` diagnostic" and, if they do, makes that the one rule | — | none yet |

## 7. `grep` and the code tables

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `GrepMatch.path` (**R**) | **`GrepMatch.name`** | A · every other item path on the wire is `name` | rename |
| per-op `x-errorCodes` called closed but missing `BAD_REQUEST`/`INTERNAL_ERROR` on several ops (F5) | one **common set** every op may answer (`PROTOCOL_MISMATCH`, `BAD_REQUEST`, `IDE_UNSUPPORTED`, `INTERNAL_ERROR`) plus each op's own | F | none |
| which channel a code arrives on is prose (F24) | a `channel` column in the generated code table: `frame`, `conflict`, `unreadable` | F | none |
| error and conflict codes bare strings | `BridgeErrorCode` and `ConflictCode` schemas (enums) | B, F | none |
| `WRONG_PROJECT`'s message renders an expectation the request left out as empty (`bound to /X`) | the message names only what the request stated | A · rework P-notes | none |
| history in the contract: "(It was `NOT_FOUND`.)", the "Until 2026-09 …" paragraph, "(It was NO_SIDECAR …)", "CODESYS used to run the op nested …", retired-name stories, internal names (`PipeServer`, `ConflictFor`, `WireProtocol.Version`, DIALECT ids) (F34) | deleted; a refused spelling appears only as the error it gets | F · CLAUDE.local.md "docs: current implementation only" | none |
| prose counts ("Eight ops", "Seven of these codes", "These five") (F36) | deleted; the tables are the count | F | none |

## Below the wire (no shape of its own; follows from B)

- `Volt.Contracts/Vocabulary/Vendors.cs` (the closed `Codesys`/`Twincat` list, `Display` throwing on a third vendor,
  `TwincatShellProcesses`) leaves Contracts: the ids and display names come from `VendorRegistry`; the XAE process names
  belong to the connector and the CLI's elevated-XAE diagnosis (W1).
- `Wire/PipeNames.cs`: one `Instance(vendor, pid)` minter instead of one per vendor (W1).
- The OpenRPC generator (`DocDataTests`) reads the enums from the shipped hosts' declarations (W2).

## Deleted

`health.networkText` · `HealthResponse.status` (prose) · `connect`/`disconnect` `ok` · `push.accepted` ·
`PushResponse.currentProjectVersion` · the `<project>` conflict row · `null` as "no version" · severity's `info`
fallback · `line`/`column` `0` · `duration` (renamed) · `GrepMatch.path` (renamed) · every history paragraph and prose
count in `wire.html` and the OpenRPC descriptions.

## Unchanged

The item path as identity and its grammar (`<folder>/<name>.<kind>`, `%XX`, whole-segment application prefixes); the
eight ops; the two push arms (`set`, `deleteItem`) and "one op per item"; the lease and per-item gates and `force`; the
quoted-version rule (a quoted version must hold); `unreadable` / `unreadableNodes` / `unwalkedFolders` /
`applications`; the frame cap; `refs` joining; `IDE_BUSY`; `grep`'s semantics; case-insensitive addressing with answers
in the IDE's spelling.

## Questions for the owner

1. **Delete `accepted`?** Recommended: yes. It says nothing the conflict list does not, and today it disagrees with it
   when a first op lands only partly. Against: every client's first branch is `if (!accepted)`; they rewrite it as
   `if (conflicts.length)`.
2. **The lease as an error frame?** Recommended: yes. A conflict is an op's, and the lease is the request's. Against:
   the IDE's current version then travels in the message only, not as a field (our CLI prints it; nothing parses it).
