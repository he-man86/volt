> Superseded 2026-10-30: the current network-text spelling is packages/volt-cli/docs/network-text.html.

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

**Protocol: stays 1** (owner 2026-10-24: "protocol stays at 1 during this complete refactor … we are still finetuning
protocol 1"). This shape IS protocol 1; the number does not move. Every request still states it (`protocol: 1`, principle
D), so a client that sends none, or another number, is refused by name before the body is read; the previous release's
client sends none and is refused that way. There is no negotiation and no compatibility path: PLC Assist moves to this
shape in one step.

Findings marked **R** come from the non-blind re-run of the foreign-client review (2026-10-24, `060bdfb0ee`), **B** from
the blind one (task 1.1, section "Blind review"); the rest trace to
`archive/2026-10-24-volt-cli-rework/input/foreign-client-review.md` (F-numbers) and `map-and-rating.md` (W/P).

## 1. Envelope and frames

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `{op, body}`; the protocol only on `health` | `{op, protocol, body}`, `protocol` required | D · P4: `health.protocol` is the only carrier; the mixed-version refusal is client-side only | send `"protocol": 1` on every request |
| a client of another protocol is served | error frame **`PROTOCOL_MISMATCH`**, naming both numbers, before the body is read | D | upgrade, no retry |
| `body` absent / `{}` / `null` unstated (F2) | `body` absent ≡ `{}`; `null` is `BAD_REQUEST` (already true for members) | A | none |
| connection lifetime unstated (F2, B22) | stated: **one request per connection**; the bridge closes it after the terminal frame (`result` or `error`, whatever the code); concurrent requests use separate connections | F · `PipeServer.Handle` reads one line, answers, disposes | none (states current behaviour) |
| `ProgressFrame` not in the OpenRPC; `phase` only in prose (F29, **R**) | `ProgressFrame` schema in the document: `phase` enum of the six declared phases (built 3b, see "Built (step 3b)" 1), `phaseIndex`/`phaseCount` never sent by a bridge, `total` absent = indeterminate | F | none |
| encoding unstated (F26) | stated: **UTF-8 without BOM; every frame is one line ending in `\n`** (no `\r`). A request may end in `\r\n` (the `\r` is JSON whitespace); a request starting with a BOM is `BAD_REQUEST`; a request with no `\n` is not answered until the client closes (measured, task 1.2) | F | write no BOM; end each request with `\n` |
| `info.version` `"1"` vs `protocol` integer (F15, B24) | `protocol` is a JSON integer (`"1"` is `BAD_REQUEST`); `info.version` is OpenRPC's string `"1"`, documentation only | A | send the integer |
| the terminal frame's wrapper said two ways (B5) | stated once, generated into `info.description`: `{"progress":…}`*, then exactly one `{"result":…}` or `{"error":{code, message, data?}}` | A, F | none |

## 2. `health`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `networkText: boolean` | **`languages: string[]`**: every language this bridge shows as `IMPLEMENTATION <LANG>` (the `LanguageRegistry`'s shown set as `NetworkTextSwitch` leaves it, read in one place: `ST` in the shipped build, `ST`, `LD`, `FBD` with `VOLT_GRAPHICAL=1`; the same on both vendors, task 2.1) | B · `HealthResponse.cs:39`; the flag only fits CODESYS-family graphics (W4/W5) | show a body as editable only if its language is listed |
| kinds only behind a link to `items.html` (F13) | **`kinds: [{ extension, writable }]`** from this bridge's `KindRegistry`: every declared row with an extension, ordinal; `writable` = `Source` or `WritableDescriptor` (built 3a: the declaration verbatim, the three container kinds included — 2.2's owner question, default taken) | B · a process's catalog is its host's declaration (rework F3) | read kinds from `health` instead of hard-coding them |
| `ProjectEntry.vendor`, `status` bare strings (F3) | enums in the schema, generated from `VendorRegistry` and the status set | B | none |
| `ProjectEntry.dirty: boolean`, required; an unanswered IDE reads `false` | **`dirty` optional: absent when the IDE does not answer** — CODESYS: no `dirty` member; TwinCAT: `Saved` throwing, or a row the worker does not serve (built 3a; TwinCAT's `Saved` kept as its answer — 2.5's owner question, default taken) | C · `CodesysObjectModel.cs:65` (`is bool b && b`), `BeckhoffDriver.cs:169,181` (`servedDirty ?? false`) | treat absent as "unknown", never as clean |
| `ProjectEntry.version` undefined (F28) | **deleted** (2.3: it was `ideVersion` again); the connector stamps the top-level `ideVersion` onto each row it shows | A, F | read `ideVersion` |
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
| `knownApplications` optional; omitting it beside `knownItems` silently judges unwalked paths differently (F22) | ~~required when `knownItems` is sent~~ **built 3a: optional, its absence defined** — "the client does not know them": a known path under an unread folder outside every application the walk states is never judged removed (see "Built" 4) | C · a missing baseline fact is not guessed | send it with `knownItems` when the baseline's read stated it; a directed read sends no `knownItems` at all |
| `fetch` combinations unstated (F21) | one combination table in `wire.html` (`init` / `knownItems` / `onlyItems` / `libraryManifestOnly`) and the meaning of `librariesRefreshed` | F | none |
| `FetchedItem.unsupported[].language` a bare string | enum: the declared languages, shown or hidden | B | none |

## 5. `push`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| `accepted: boolean`, plus "every op the conflicts do not name landed", plus `accepted:false` when the first op only partly landed (F8) | **`accepted` deleted.** One rule: every op `conflicts` does not name landed in full; every op after a refused one is `NOT_ATTEMPTED`, on every answer | A · two fields said one thing, and disagreed on a partial first op | landed = sent ops − conflict names |
| the lease refusal: `accepted:false` with a synthetic conflict row named `<project>` and `currentProjectVersion` | **error frame `STALE_PROJECT_VERSION`**, the IDE's current version in `error.data.currentProjectVersion` (owner 2026-10-24); `PushResponse.currentProjectVersion` deleted | A, E · a conflict names an op, and the lease is no op | pull, then push again (unchanged action) |
| receipt `newItems` (meaning unstated), no `removed` (F9) | `newItems` = the new version of every path the push created or changed — each landed `set`'s item where it now is, what of a refused op stays, and with `returnSources` every `newSources` path; never an item the IDE changed beside the push (it stays incoming); **`removed` = every path the push made disappear** (deletes, rename and move sources, what a refused op deleted), each only when held before and gone after | E | update the baseline from the receipt (`baseline − removed + newItems`); no second `refs` |
| `PushConflict.code` optional in the schema, "every conflict carries one" in prose (F6) | **`code` required**, an enum of the conflict codes plus the `NETWORK_` prefix | A, F | drop the `?? fallback` branch |
| ITEM_EXISTS's conflict may name the OTHER item (F16) | `name` is always the op's `name`; the colliding item in **`existing`** | E | map conflicts to ops by `name` |
| `ifVersion: null` and `currentVersion is null` in prose; the schema has no null (F7, F23) | absence everywhere; the prose says "no `ifVersion`" | A | send no `ifVersion` for a create |
| `set` "applied atomically" vs `renamedTo` after a refused set (F19) | wording: "one op, one conflict"; `renamedTo` says where a refused set left the item | F | none |
| `unwalkedFolders` on a push answer: meaning unstated (F9) | defined: the folders the push's walks could not read — the pre-apply walk's (their ops answered `ITEM_UNVERIFIED`) and the receipt walk's (an item there may be missing from `newItems`; built 3a: both, see "Built") | F | re-read an item under one |
| `returnSources` / `newSources`: no prose (F9) | defined: with `returnSources`, `newSources` holds the text a `fetch` would now return for every path in `newItems` (our CLI does not send it; PLC Assist may) | F | none |

## 6. `build`

| Before | After | Principle · evidence | Client changes |
|---|---|---|---|
| an unrecognised vendor severity word becomes `info` | **`severity` absent** when the vendor's value is not in the host's declared table (CODESYS: keyed on `IMessage.Severity`'s numeric `[Flags]` value, one declared bit per row; TwinCAT: the pane token; task 2.7) | C · `BuildModels.cs:30-40` | treat absent as "not classified"; `success` is unaffected |
| `line`/`column` required; `0` when the vendor states no position | **optional, 1-based, absent when the vendor states none** | C · `TcObjectModel.Build.cs:192` (`Line = 0`), the CODESYS recording carries `line: 0`; TwinCAT 4024 writes `(line)` and no column (task 2.6, live) | test for presence, not for 0 |
| `duration` without a unit (F25) | **`durationMs`** | A | rename |
| `success` from a different vendor signal on each (F25) | unchanged: each vendor's own signal. Task 2.6 measured that they do not agree with "no `error` diagnostic" (TwinCAT's compiler crashing writes an unshaped line), so that is no rule | C | never derive success from the diagnostics |

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

## Blind review (task 1.1, 2026-10-24)

A fresh agent with only sections 1–7, `wire.html` and the OpenRPC document (no repo) wrote a client on paper and listed
25 places it had to guess. Folded as follows (rows above carry **B**n where they changed):

| B | Guess | Resolution |
|---|---|---|
| 1 | a new client cannot tell a previous-release bridge (also `protocol: 1`) | ~~that bridge's strict envelope reader refuses the unknown member `protocol`~~ **measured false in 3a**: the previous release reads the envelope with `WireJson.Read`, which skips an unknown member, so it serves a new client's request and answers in the old shape. This release reads the envelope strictly, so B1 holds from here on; see "Built (step 3a)" item 1 |
| 2 | ops before a pre-flight refusal: landed or not | one rule per phase, stated in `wire.html`: a pre-flight refusal lands nothing (each refused op its code, every other op `NOT_ATTEMPTED`); an apply-time refusal lands the ops before it; `newProjectVersion` is absent exactly when nothing landed |
| 3 | which receipt members are always present | `conflicts`, `newItems`, `removed` always present (may be empty); `newProjectVersion` iff something landed; a `partiallyApplied` op's surviving changes are in `newItems`/`removed` |
| 4 | the fetch combination table's content | the table is written in 3.9 from the code's behaviour per combination (walk scope, `items`, `removed`, `librariesRefreshed`, refusal) |
| 5 | result wrapper | section 1 |
| 6 | ProgressFrame members | 3.9 generates every member with presence and meaning (`operation` = the op name, `phase`/`phaseIndex`/`phaseCount` together or absent) |
| 7 | what `line`/`column` count against | 2.6 measures it; the schema states base and unit, or the field is absent |
| 8 | `ifVersion` × `force` × arm | one table in `wire.html` (3.9), from the gate code |
| 9 | `existing` / `currentVersion` / `DUPLICATE_CHILD` | `existing` is a path, present only when it differs from `name`; `currentVersion` is `existing`'s (else `name`'s); `DUPLICATE_CHILD` is a collision below the item (a member), stated so |
| 10 | facts only in `message` | `error.data` carries them: `PROTOCOL_MISMATCH` → `data.bridgeProtocol`, `STALE_PROJECT_VERSION` → `data.currentProjectVersion` |
| 11 | common set vs `health` / `disconnect` | the common set is per op in the generated table; `health` answers only `PROTOCOL_MISMATCH`, `BAD_REQUEST`, `INTERNAL_ERROR`; "fails only with" goes |
| 12 | one `channel` per code | `channel` is a set |
| 13 | `NETWORK_*` in an enum | `ConflictCode` = enum ∪ pattern `^NETWORK_[A-Z_]+$`, the values listed from network-text's error table; `line` present iff a `NETWORK_` code |
| 14 | open or closed enums | closed per bridge: the bridge's `health` states its catalog, so a value it did not list is a bridge bug; current value lists inline in the generated tables |
| 15 | `kinds` member format | `extension` without the dot; `writable: false` = every push op on it is a conflict `BAD_REQUEST` |
| 16 | `NotSearchedItem` bare reason | `{ name, code, reason }` like the unreadable entries (3.7) |
| 17 | `IDE_BUSY` not observable | unchanged: a retry after the running op is the action; reads wait for the IDE (stated). Not added to `health` — no measured need |
| 18 | identity strings | `connect.project` / `expectedProjectName` take `ProjectEntry.project`; `expectedPlatform` takes `ProjectEntry.vendor`; both compared ordinal ignoring case (after 2.4) |
| 19 | paused vs nothing to serve | open, 2.5 with `dirty`: measured before a member is added |
| 20 | `body` required in OpenRPC; empty `knownItems` | `body` optional in the schema; an empty `knownItems` is a baseline like any other (built 3a: `knownApplications` beside it when the client knows them, "Built" 4); the `wire.html` example is fixed |
| 21 | rows waiting on a measurement | each is settled by its section-2 task before 3.x builds it; until then it is not part of the shape |
| 22 | lifetime, CR LF, half-close | section 1 (measured, 1.2) |
| 23 | grep cut detection | `GrepMatch.cut: true` when the text was cut (absent otherwise); the cut's unit is read from the code and stated in 3.7 |
| 24 | `protocol` type | section 1 |
| 25 | stale sentences left | deleted in 3.9 (`BRIDGE_PROTOCOL`, "Only on an accepted push", `unavailable`, "MUST check `accepted`", `accepted:false`) |

## Below the wire (no shape of its own; follows from B)

- `Volt.Contracts/Vocabulary/Vendors.cs` (the closed `Codesys`/`Twincat` list, `Display` throwing on a third vendor,
  `TwincatShellProcesses`) leaves Contracts: the ids and display names come from `VendorRegistry`; the XAE process names
  belong to the connector and the CLI's elevated-XAE diagnosis (W1). Built 3a: each host declares its own `VendorRow`
  (`CodesysDriver.Row`, `BeckhoffDriver.Row`); the two components that ship WITHOUT the hosts know the vendors they ship
  beside — the CLI in `Volt.Cli/Sync/ClientVendors.cs` (a `VendorRegistry`, plus each vendor's no-bridge remedy and shell
  processes as data, so the resolver has no vendor branch) and the connector in `Volt.Connector.Core/ConnectorVendors.cs`.
  The pipe name is the contract between them. The new-vendor ratchet's CLI and Contracts pins went to 0.
- `Wire/PipeNames.cs`: one `Instance(vendor, pid)` minter instead of one per vendor (W1). Built: `Prefix`,
  `PrefixForVendor`, `Instance` — no vendor constant.
- The OpenRPC generator (`DocDataTests`) reads the enums from the shipped hosts' declarations (W2).

## Built (step 3a, 2026-10-24): where reality differs

1. **The previous release does not refuse our `protocol` member (B1 measured false).** Its `PipeServer` read the envelope
   with `WireJson.Read`, which skips an unknown member, so a client of this release is SERVED by a previous-release
   bridge (an IDE that kept the old in-proc bridge after an update) and reads its old answer: `newItems` the full map,
   no `removed`. The CLI's own `health.protocol` check could not tell them apart either (both 1) and is deleted: the
   bridge now refuses another protocol itself, and from this release the envelope is read strictly (an unknown envelope
   member is `BAD_REQUEST`). So 4.3's "our client is refused by the previous bridge by name" will fail against the
   previous release; it holds from this release on. **For the owner:** accept it (no users; PLC Assist and the bridge
   update together), or make this release protocol 2 after all. Default taken: protocol stays 1; 4.3 measures it.
2. **`unwalkedFolders` is both push walks' blind spots**, not the pre-apply walk's alone: with `newItems` now the
   delta, a changed item the receipt walk could not reach is simply absent from it, and only the receipt's unwalked
   folders tell a client so.
3. **A push of no ops lands nothing**, so it answers no `newProjectVersion` (one rule); it still walks once, for the lease
   and its `unwalkedFolders`. A first op that partly landed (F8) is a landing: the answer carries `newProjectVersion` and
   what of the op stays in `newItems`/`removed`; a first op of which nothing stays lands nothing, and no receipt is walked.
4. **`knownApplications` is NOT required with `knownItems` (gate 3a reversed the F22 row; for the owner).** Required, it
   forced the one client that does not know them to lie: the CLI's baseline rebuilt from the `volt/ide` tree (a pull with
   no sidecar) cannot tell where an application begins, and sending `[]` claims "the read stated no application" — so a
   path an unread device hides was placed in the pool and paired with a pool POU of its name, and the pull deleted a
   file whose item the IDE still holds. Absent now says "the client does not know them", and the bridge does not guess:
   a known path under an unread folder outside every application the walk states is never judged removed. A client that
   knows them sends them (the CLI from its sidecar). Tests: `SidecarBaselineTests` (the recovery pull keeps the file),
   `MultiApplicationTreeTests` (both forms), `WireFinalShapeTests.A_baseline_without_its_applications_is_served`.
   **For the owner:** the F22 concern (a client that forgets it is judged by another rule) is answered by that rule being
   the conservative one — a forgotten field keeps a file, never deletes one.
5. **The protocol test seam is gone** (`BridgePipeHost(…, int? protocol)`): a client of another release is its frame,
   written by the test; a bridge of another release is a server answering what it answers. The ratchet is 0.
6. **`volt push` no longer says "the IDE also changed X while the push ran"**: the receipt names only what the push did,
   so the CLI cannot see such an item; it stays incoming (its old version kept), which is the safety property.
7. **Unreadable codes, per producer**: `UNREADABLE` — a kind, property, library-manager or materialize read that failed
   (a coded read failure keeps its own code), an item TwinCAT must not open (C2i), an inherited exclusion the walk cannot
   place; `UNSUPPORTED` — a container holding what no text spells, an excluded folder and every item under it.

## Built (step 3b, 2026-10-24): where reality differs

1. **Progress phases are six, not two.** The bridge states `walking`, `reading`, `searching` (grep), `building`,
   `checking` and `applying` (push); section 1's row named the first two only. They are now constants
   (`ProgressFrame.Phases`), the schema's enum is generated from them, and a gate refuses a phase spelled as a literal.
   `phaseIndex`/`phaseCount` are never sent by a bridge (the CLI sets them on the frames it re-emits), so B6's "together
   or absent" is "always absent on the bridge wire"; the schema says so on both members.
2. **`ConflictCode` is one closed enum, not enum ∪ pattern (B13).** `ConflictCodes.Network` is a closed list in the code,
   so the enum names every `NETWORK_` code exactly; the prefix rule and "`line` iff `NETWORK_`" are in its description.
3. **The `channel` table's `unreadable` set is `UNREADABLE` and `UNSUPPORTED`** — the codes the walk's producers state
   ("Built (step 3a)" 7). A read that failed with a code of its own keeps it, so `UnreadableItem.code` is typed
   `BridgeErrorCode`, not a narrower enum.
4. **The vendor enums are read from the hosts' source.** The CODESYS host is net48 and the TwinCAT host net10-windows,
   so the generator (`DocDataTests`, net10) cannot load them: it reads every `Volt.Ide.*/**/*.Seam.cs` declaration
   (`VendorRow Row`, `LanguageRow.Shown/Hidden`, `IecFormat.KindRows`) and fails by name on one it cannot read — the same
   route the items page already takes for the CODESYS property refusals.
5. **CODESYS severity, measured live on 3.5.22.40 (3.6).** A warning silenced with `{warning disable C0196}` puts no
   message into the build's categories at all; three builds (a warning; the suppressed warning; warning + suppressed
   warning + two errors) gave only single declared bits, every message classified, no combined value. The table is the
   five declared bits; `SuppressedWarning`/`SuppressedInformation` are no rows (owner question 2.7, default taken).
   The enum is `[Flags]`, so the error bits decide (gate 3b): a value carrying `FatalError` or `Error` is an error
   whatever else it carries, and a value that is no number or carries a bit no installed version declares cannot be
   ruled out as one, so its build does not answer success (an unknown fact is never a clean build). Only a value of
   declared non-error bits that is no single row (a suppressed warning) is unclassified and fails no build.
6. **A failed build names an error in `BuildService`, for both vendors**, besides TwinCAT's parser carrying an unshaped
   `… error: …` line: a vendor can count a failure and write nothing Volt reads, and the answer then states that, as an
   error with no position. The unshaped line is carried only from the pane of a build `LastBuildInfo` counts as failed
   (in a successful build's pane `error:` states no failure), and it is no boundary: a quoted continuation that holds
   `error:` stays in its message (gate 3b). It is English-only — a German XAE's `Interner Fehler:` reaches only
   `BuildService`'s generic error. The CODESYS position scrape (`ParseLine`/`ParseColumn` over the message text, never a match
   on 6446 recorded diagnostics) is deleted: CODESYS states no position.
7. **`WRONG_PROJECT` keeps its remedy clause** (`— open the named project in the IDE, or reconnect`): the CLI prints the
   message as the refusal, and it was the user's only next step. The expectation it names is now only what the request
   stated (§7).
8. **The CLI's own `--json` build result is `durationMs` too**, and its human output prints an unclassified severity as
   `[unclassified]`; volt-control reads `durationMs`, an optional `severity`, and a `dirty` that may be unknown: an
   unknown `dirty` makes no "IDE changed" edge (it read as clean before), and it keeps the last STATED value as the
   baseline (`healthStep`), so clean → unknown → dirty still signals the edit (gate 3b).

## Step 3c (task 3.9a): INTERNAL_ERROR only for a Volt bug

**Target.** `INTERNAL_ERROR` means one thing: Volt reached a state it must never reach. A request the bridge cannot
honour, an IDE state, or a vendor limit answers its own code. Measured at `30ec5ccd97`: 151 uncoded `throw new` sites
in `src/` (outside Contracts and the CLI; `WireVocabularyTests.Uncoded`) — 118 `InvalidOperationException`, 26
`NotSupportedException`, 5 `MissingMethodException`, 2 `COMException`, 1 `IOException` — counted per FILE, so the gate
cannot say which throw in a file is which, and every one reaches a client as `INTERNAL_ERROR` (a `NotSupportedException`
as `UNSUPPORTED` in a push conflict but `INTERNAL_ERROR` on a frame: one fact, two codes by channel).

**Choice: every site states its class at the throw.** Each of the 151 becomes one of:
- a **coded refusal** — `BridgeException` with its situation's code (`BAD_REQUEST`, `UNSUPPORTED`, `IDE_UNSUPPORTED` —
  every `MissingMethodException`, a vendor API this IDE version lacks —, `UNREADABLE`, `PLC_DISCONNECTED`, `IDE_BUSY`, …);
- an **invariant** — `VoltInvariantException` (new, `Volt.Contracts`, `ICodedError` → `INTERNAL_ERROR`): a state Volt
  itself must never reach (a `PushOp` with no apply arm, a registry conflict at start, a reader-refused shape a writer
  was handed). Its message names the broken invariant;
- **caught inside** — a throw a named catch turns into a coded answer before any client sees it (`TcHierarchy` →
  `TcObjectModel.Explorer`, `PipeAcl` → the host). It throws the catcher's own type, so the census does not see it.

Then `UncodedThrow` counts **0** and stays 0 (any BCL `throw new` fails by name); the new ratchet counts
`VoltInvariantException` per file and fails on a RISE only (a fall just lowers the line). `ConflictFor`'s TYPE mapping
(`NotSupportedException → UNSUPPORTED`) is deleted: the code comes from the throw, so a frame and a conflict answer the
same code. `ArgumentException` stays uncounted (a caller's broken invariant by definition).

Rejected: **keep per-file counts with comments** — a count cannot classify a site; it is how 151 accumulated.
**Map by exception type at the boundary** — a type is not a situation (`InvalidOperationException` is a refusal in one
file and an invariant in the next); it is the guess the zero-fallback rule forbids.

**Stays INTERNAL_ERROR, by name:** the invariants, and a FOREIGN exception (COM, the vendor's .NET API) reaching
`PipeServer`/`ConflictFor` uncaught — Volt did not classify an IDE call, which is Volt's bug; it stays logged whole
(`CallFailure.LogText`) and is coded at its call when a log shows it. No catch-all rewrites a foreign exception.

**Migration.** One commit per package (Engine, Ide.Codesys, Ide.Twincat, Wire/Relay), each lowering the census; a
reclassified site a request can reach gets a test asserting its code (unit, plus a contract-suite case when the live
wire reaches it). Report: 151 uncoded → 0; N invariants; per code, the count reclassified. No wire shape changes: only
which code an existing failure carries. PLC Assist: one line in `plcassist-note.md` (`INTERNAL_ERROR` now means a bug).

## Built (step 3c, 2026-10-24): where reality differs

Counts are in tasks 3.9a. Where the build departs from the text above:

1. **A coded `NotSupportedException` (`Volt.Engine.UnsupportedException`).** Some catches ROUTE on a vendor "cannot":
   the TwinCAT in-place network write falls back to the native builder on one, an unchanged-network render reads one
   as "changed", the pre-flight prefixes a member's site to one. A `BridgeException` there would have changed what the
   writer does, so those refusals are an `UnsupportedException` — a `NotSupportedException` carrying `UNSUPPORTED`
   itself. `UnrepresentableBodyException`, `ChildRefusedException` and `TcEnoRefusal` derive from it, so deleting
   `ConflictFor`'s type mapping moved no refusal's code. The vocabulary census counts each one constructed as an
   UNSUPPORTED raise site.
2. **"No wire shape changes" did not hold, for the owner.** IDE_UNSUPPORTED was "the bridge serves nothing"; as the
   code of a missing API it is now also the answer of ONE call, so it reaches a push conflict (`ConflictCodes.FromBridge`
   gains it — one value added to the `ConflictCode` enum) and an unreadable entry (CODESYS 3.5.18.30's Project
   Settings). No client branches on it from a frame (the connector and the UI read `health.unsupported`), and its
   remedy is the same (the IDE has to change), so the protocol stays 1; the shape is re-pinned. The SP18 NWL
   constructor refusal (UNSUPPORTED since 2026-10-10) is the same situation and is re-coded with it.
3. **What fails a CODESYS walk is a binder failure, not a code.** A walk names ONE object unreadable for its own fault
   and fails the op for a fault that would hit every object. That axis is not the code: IDE_UNSUPPORTED is also the code
   of a member ONE node lacks (a library manager without `GetAllLibraries`, a missing object manager met by one folder's
   properties), and routing the walk on the code made such a node fail every op that walks — the SP18 "212 of 218" class
   (gate 3c review, finding 4). So the binder failures — the sites that were `MissingMethodException` (`Reflection.Overload`,
   `InvokeMethod`, the two scripting overload searches, `move`) and a node exposing no `get_name` at all — throw
   `SurfaceMismatchException` (Volt.Ide.Codesys: a `BridgeException`, IDE_UNSUPPORTED), and `Reflection.SurfaceMismatch`
   is `MissingMemberException`, `AmbiguousMatchException` or that type, as before 3c. Every other IDE_UNSUPPORTED keeps
   the walk going with its node named unreadable; C5 (no object manager → the folder named, its subtree unwalked) stands
   as it was written — the re-premise is withdrawn.
4. **`build` of a project with no application is UNSUPPORTED**, a frame (it was a failed build whose one diagnostic
   said so); `build`'s `x-errorCodes` gain UNSUPPORTED.
5. **A CODESYS object whose name the IDE answers null has no identity** (the owner's 2026-10-18 rule for an object
   whose TYPE the IDE cannot state): `GetName` refuses it UNREADABLE (a read answered with nothing), the walk unwalks
   its folder and goes on, and a lookup through that folder answers its ITEM_UNVERIFIED (`TreeLookup.Read`, below). It
   was an ITEM_UNVERIFIED error frame for the whole refs/fetch/grep/push, whose documented cause is TwinCAT's.
5a. **A lookup's one mapping covers the driver's UNREADABLE** (gate 3c review, finding 1). With the drivers' "answered
   nothing" throws coded UNREADABLE, `TreeLookup.Read` let them pass, so a sibling the IDE answered with nothing made a
   push op's lookup answer UNREADABLE — whose remedy points at the op's item, never read. A read fault during a lookup is
   the folder's: an uncoded fault or an UNREADABLE is ITEM_UNVERIFIED naming the folder and the child, the driver's
   refusal as the inner exception; any other code (a missing API, a lost project) passes.
5b. **The delete-then-create advice is one refusal's** (finding 2): a member the IDE reports no declaration for throws
   `MemberWithoutDeclarationException` (Engine, UNREADABLE), and `PushService.ReadLive` adds the advice to that type only.
   An UNREADABLE read of any other cause keeps its own reason: a delete and re-create drops what the text does not carry.
5c. **A Volt bug is logged whole on the push channel too** (finding 7): `ConflictFor` writes an INTERNAL_ERROR conflict's
   exception, with its stack, to the log at Error, as `PipeServer` does for a frame.
5d. **A Volt bug is no unreadable object** (finding 6): `Versioning.SafeVersion` keeps a read's own code — UNREADABLE,
   UNSUPPORTED (a vendor language that is no word), IDE_UNSUPPORTED — and lets INTERNAL_ERROR through, so the op answers
   it instead of filing the bug as one item's state. Other codes a read may raise (ITEM_UNVERIFIED through a
   declarations index, IDE_LOST_ITEM) still reach an entry as since step 3a; none is measured on a read path.
5e. **The census counts every type Volt does not declare** (finding 3), not a list of BCL names, which let two
   `FormatException`s through (`TcArchiveWriter`'s parse-side rule 6, now `UnsupportedException`). The OS's own types
   below the wire — `Win32Exception` and `UnauthorizedAccessException` where `PipeAcl` binds a pipe or reads a token,
   `ProcessElevation.Self`, the relay's stalled send (`TimeoutException`) — reach no frame and are pinned per file
   (`BelowTheWire`, a rise fails).
5f. **A missing facet is that node's** (finding 8): `Facet` refuses UNSUPPORTED, not IDE_UNSUPPORTED. The CLI advises
   on IDE_UNSUPPORTED that the IDE has to change, inviting no retry (finding 10).
6. **Caught inside, by a named type** beyond the two the text names: `HierarchyReadException` (it keeps the HRESULT, so
   a missing proxy still becomes IDE_UNSUPPORTED), `PipeBindException` (an `IOException`, the host's), and the relay's
   `RelaySocketGoneException` (every send caller catches it).
7. **Still a catch-all, for the owner:** `BuildService` answers a FOREIGN exception during a build as a failed build
   with one error diagnostic ("Build failed: …"), not INTERNAL_ERROR — a catch that rewrites a foreign exception, which
   the text above rules out. Left as it is: changing it changes `build`'s documented outcome, and no measured failure
   reaches it.

## Built (3.6b and step 4, 2026-10-24)

1. **A build line is placed by the item's format.** A driver states the vendor's line in the object it names (the seam:
   declaration lines, then code lines; an action has no declaration, DIALECT D36); `BuildService.Place` asks the kind's
   `IItemFormat.LineOf`, which reads the fetched text back, checks it writes that very text, and places the line with
   `StWriter.Lines` (pinned against the writer's text). No certain place — a property accessor (the wire names no
   accessor), a network or hidden body, a line past the object, a diagnostic naming no item — is no `line` and no
   `column`. `volt build` and volt-control print `name:line[:column] (member)`.
2. **A `null` request frame is BAD_REQUEST**, not PROTOCOL_MISMATCH: it is no envelope (contract suite `frame/null`).
3. **A `sourceText` starting with U+FEFF is refused BAD_REQUEST** in the pre-flight (4.3b's principle, refuse rather than
   strip-and-state: the same rule as a request frame with a BOM; the CLI strips one at its file boundary).
## 4.3c The client checks the bridge's shape

**Target.** A client of this wire meets a bridge whose `health` has no `languages` or no `kinds` (it predates this wire,
e.g. `0.1.17931`, which reads our envelope leniently and serves it) and refuses it by name before any other op:
"this bridge predates this wire: update it". Protocol stays 1; with this the mixed-version cell (4.3) refuses in both
directions.

**Who checks** (measured by reading every pipe client on dev, `01d26f787a`):
- **the CLI** (`BridgeClient`) — `init` and `status` read `health` first; `pull`/`push`/`build`/`grep`/`show` do not.
- **the connector** (`PerPipeProjectSource.ScanAsync`) — reads `health` on every poll, before any `connect`.
- **volt-control** has no pipe client (it reaches bridges only through the CLI and the connector's `:8550`), so it checks
  nothing itself; it SHOWS the refusal both of them name.
- **`Volt.Relay`** is not a client: it ships inside the bridge and forwards to its own pipe, so it can never meet an older
  one. The relay's client side is PLC Assist's own client (it runs in Docker, outside the pipe's reach, and comes in over
  the relay), so PLC Assist makes the same check; the note to them carries it.

**Choice.** One function in `Volt.Wire`, `WireShape.Require(JsonElement health)`, checks the PRESENCE of both members in
the raw `health` result (not the DTO: `HealthResponse`'s `= new()` defaults would turn an absent member into an empty one,
principle C). An empty list is a fact and passes. Two callers:
- `BridgeClient`: the first call of any op on an instance is `health`, checked, cached for that instance (one CLI process,
  one check); `GetHealth` returns the cached answer, so `init`/`status` cost nothing extra and the rest pay one
  `health` round-trip, which the bridge answers from its snapshot, never on the IDE thread. Refused as the CLI-local code
  **`BRIDGE_PREDATES_WIRE`** (like `BRIDGE_ACCESS_DENIED`), naming the pipe and the bridge's `bridgeVersion` if stated.
- the connector: a pipe whose `health` fails the check gives no project rows and one `RefusedBridge` row with that
  message, so the connection view names the IDE and why, and nothing ever `connect`s to it.

**Rejected.** Required members in the `HealthResponse` reader: catches only commands that read `health`, and fails as a
JSON error, not by name. A health inside `PipeClient.Send` before every op: doubles every call, and the relay's `Forward`
would pay it for a bridge of its own build. Protocol 2: owner, 2026-10-24 (stays 1). A bridge-side check: the old bridge
is already shipped.

**Stays refused by name.** A request without `protocol` (`PROTOCOL_MISMATCH`, bridge side, unchanged); a `health`
without `languages` or `kinds` (`BRIDGE_PREDATES_WIRE`, client side). Nothing is read from such a bridge, so nothing is
misread.

**Red tests first.** `Volt.Cli.Tests`: a fake pipe answering a `health` without `languages` (and one without `kinds`) —
`volt pull` and `volt push` exit refused `BRIDGE_PREDATES_WIRE` and the fake saw no op but `health`. `Volt.Connector.Tests`
(`PerPipeProjectSourceTests`): the same `health` gives one `RefusedBridge` row and no project. The mixed-version cell's
"this CLI against the previous bridge" turns from served to refused.

**Migration.** None for Volt (no users). PLC Assist: one bullet in `plcassist-note.md` under `health` — read `health`
first and refuse a bridge whose answer lacks `languages` or `kinds`.

## 4.3d The canonical layout is part of the wire

**Target.** A client can predict, from `wire.html` alone, the text a `fetch` returns for what it pushed. Today the
writer's layout is stated nowhere, so PLC Assist read one inserted blank line (4.3b a) as 80 changed lines. PLC Assist's
client runs in Docker, outside .NET, so the contract is a stated rule a client can implement, not a function to call.

**Choice.** One table, `#layout` in `wire.html`, rendered by `doc.js` from `data.js` like `items.html`'s kinds. Its rows
are `StWriter`'s rules, one made-up example each (`a`, `b`, `x`):
LF line ends, the file ends in one `\n` after the item's last character · a GVL/DUT is its declaration, then its
`%`-lines · a POU is its declaration, the `IMPLEMENTATION` line, its `%`-lines, its code · one blank line, then the
`END_…` line mirroring the header · each member after one blank line, below the END line (inside the block for an
interface) · member order METHOD, ACTION, PROPERTY, then name, ordinal · a POU's member is declaration, `IMPLEMENTATION`
line, `%`-lines, code, `END_METHOD`/`END_ACTION` · a POU's property is declaration, `%`-lines, `GET` then `SET`,
`END_PROPERTY` · an interface's member has no `IMPLEMENTATION` line and no code (method: declaration, `%`-lines,
`END_METHOD`; property accessor: keyword, declaration, `END_GET`/`END_SET`) · every other character verbatim (inner
blank lines, trailing whitespace, the trailing newlines a declaration or a body ends with). The rows live in
`test/Volt.Engine.Tests/format/st/StLayoutRules.cs`:
`(id, sentence, ItemContent example, Func<string,bool> holds, Func<string,string> break, PushOutcome push)` — `break`
is the hand-made non-canonical variant, and `push` is what a push of it does, stated per row on the page and pinned per
row: `canonical` (`StWriter.Write(StReader.Read(variant))` is the canonical text — `lf`, `end-line`, `members-below`,
`member-order`, `property`), `kept` (what breaks the rule is the item's own text and comes back as pushed — `member`:
a blank line before `END_METHOD` is the code's last line; `verbatim`), or `refused` `INVALID_ST` (the rule is structure
the reader needs — `declaration-only`, `pou`, `members-inside`, `interface-member`) (4.3d second review: the page said
every row's variant comes back canonical; 6 of 11 do). Further
layout-only texts — no final LF, extra LFs after END, 0 or 2 blank lines before a member, an empty body with no blank
line, an interface with no blank lines, CRLF and CR on a POU, a GVL and a DUT — are pinned beside the rows). CRLF and
a lone CR are layout-only at the reader, for EVERY kind: `StReader.LfLines` is the one line-ending rule (fixed in 4.3d
review: a GVL's and a DUT's declaration kept its CRs and reached the IDE as `END_VAR\r`; only composite kinds were
normalised, and 4.3b's (b) pushed only `.pou` files, so it measured the reader, not the IDEs). The WRITER applies the
same rule to what the IDE holds (`StWriter.LfContent`, per text before the layout joins them), so the `lf` row holds on
a fetch too: a CR an earlier push left in the IDE, or one the IDE produces, is fetched as LF (0 CRs in the six corpora,
so no IDE was seen handing one back; the rule no longer rests on that). A CR is a line end wherever it stands — in a
string literal or a comment too (0 CRs in the corpora; a raw line break in a literal is no valid literal either way). Two tests:
`DocDataTests` generates each row's example as
`StWriter.Write(example)` into `data.js` (the existing gate: the doc cannot drift from the writer), and
`StLayoutRulesTests` asserts `holds` on that output AND fails on a hand-made non-canonical variant of it (the rule bites).
A writer change that breaks a rule turns red there; a new rule without a row is caught by review, not a census (the
writer has no rule list to count — named, not hidden).

**Rejected.** Write a minimal separator so text round-trips byte-identical: a canonical-file change — every pulled POU
file, 114 C# and 40 TS test texts and the six corpora's workspace files (measured in 4.3b); owner kept the layout.
Hand-written prose rows: drift, nothing pins them. A canonicalize op or a push answer echoing stored text: a wire
addition for what `fetch onlyItems` already answers. A shared normalizer library: PLC Assist is not .NET.

**Stays refused by name.** A `sourceText` starting with U+FEFF (`BAD_REQUEST`, 4.3b c). A POU whose declaration opens
with no PROGRAM / FUNCTION_BLOCK / FUNCTION has no END line to mirror (pull: `unreadable`, `UNSUPPORTED`). Non-canonical
text (CRLF, no blank line, any member order) stays ACCEPTED: the fetched text is its canonical form, and the table says so.

**Open, for the owner (a grammar edge case, not documented).** An EMPTY body has one spelling too few: the writer
writes body `""` as `IMPLEMENTATION ST`, blank line, END, and body `"\n"` with three blank lines, so a pushed text with
TWO blank lines there (one of its own, then the separator) reads as `""` and comes back with one — the pushed blank
line is dropped. With code present (`b;`, two blank lines, END) the same lines survive. Cause: a body string cannot
tell zero lines from one empty line, and the writer joins an empty body with no newline. Removing it changes the
canonical text of every empty body (the 4.3b minimal-separator option would too).

**Open, for the owner (a vendor divergence the `interface-member` row cannot state).** The row gives an interface
PROPERTY's GET/SET a declaration slot. A NON-EMPTY declaration there is written on CODESYS and fetched back byte for
byte (DIALECT D41; measured live 2026-10-24, 3.5.21.40) but refused `UNSUPPORTED` on TwinCAT, nothing landing
(D21: writing it can crash TcXaeShell, and TwinCAT stores one constant declaration Volt spells empty). So a client
cannot predict the answer from `wire.html#layout` alone, only from the vendor. Both answers are pinned live
(`layout-rows.test.ts`, "interface-member: a non-empty interface-accessor declaration…"); the row's example keeps the
empty declaration both take. Ways out, each the owner's: refuse a non-empty one on CODESYS too (the vendors then
agree, and the slot is always empty — the row loses it); or keep it and name the TwinCAT refusal on the page.

**Migration.** None for Volt: no file moves (no workspace file holds a CR: 0 in the corpora); the reader now reads a CR
in a GVL or DUT as a line end (as it did in a POU), and the writer writes a CR the IDE holds as LF. 4.3b is ticked against this rule ((a) and (b)
are rows). `plcassist-note.md`: one bullet under `fetch` — compare a pushed text against the fetched one, or against
the `#layout` rules, never byte-for-byte against what was sent.

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

## Owner decisions (2026-10-24)

Both answered YES: `accepted` is deleted, and the lease is the error frame `STALE_PROJECT_VERSION` — with the IDE's
current version as a FIELD of the frame (`error.data.currentProjectVersion`), not only in the message, so a client can act
on it without parsing text.

## Questions for the owner (answered above)

1. **Delete `accepted`?** Recommended: yes. It says nothing the conflict list does not, and today it disagrees with it
   when a first op lands only partly. Against: every client's first branch is `if (!accepted)`; they rewrite it as
   `if (conflicts.length)`.
2. **The lease as an error frame?** Recommended: yes. A conflict is an op's, and the lease is the request's. Against:
   the IDE's current version then travels in the message only, not as a field (our CLI prints it; nothing parses it).
