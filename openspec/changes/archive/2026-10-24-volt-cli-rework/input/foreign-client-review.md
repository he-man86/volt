# volt-cli-rework 1.1b — foreign-client review of the bridge wire

Reviewer stance: a developer outside Volt who writes a client against the named-pipe API, reading ONLY
`packages/volt-cli/docs/wire.html` (raw HTML, as committed) and `packages/volt-cli/docs/volt-bridge.openrpc.json`.
No source, tests, other docs or live pipe. Date: 2026-10-20, at `62451aa676`.

Note on method: wire.html's `data-render="op-names|errors|statuses|severities|vendors|ops|schemas"` placeholders are
filled by `assets/data.js` at view time. A stranger with the two named files sees them EMPTY. Findings below treat
that as part of the contract a stranger gets (F3).

Severity scale: **BREAK** = a client written from the docs would misbehave; **MISUSE** = a plausible second client
gets it wrong; **COSMETIC** = noise, stale wording, leaked internals.

---

## 1. Client sketch

### 1.1 Types (from the OpenRPC components, plus what prose adds)

```ts
// ---- framing (NOT in the OpenRPC document; from wire.html#framing) ----
type Request<Op extends string, B> = { op: Op; body?: B }          // is `body` optional for health/disconnect? (F2)
type ProgressFrame = { progress: { operation: string; done: number; total?: number; phaseIndex?: number; phaseCount?: number } }
type ResultFrame<R> = { result: R }
type ErrorFrame = { error: { code: ErrorCode; message: string } }
type Frame<R> = ProgressFrame | ResultFrame<R> | ErrorFrame          // exactly one key per frame

type ErrorCode =                                                    // frame codes (wire.html#errors)
  | "PLC_DISCONNECTED" | "IDE_UNSUPPORTED" | "IDE_BUSY" | "WRONG_PROJECT" | "BAD_REQUEST"
  | "IDE_LOST_ITEM" | "UNSUPPORTED" | "DUPLICATE_CHILD" | "INVALID_ST" | "UNREADABLE" | "INTERNAL_ERROR"
  | "ITEM_UNVERIFIED"                                               // gate code that can also be a frame
type GateCode = "STALE_PROJECT_VERSION" | "STALE_ITEM_VERSION" | "ITEM_EXISTS" | "ITEM_MISSING" | "ITEM_UNVERIFIED"
type ConflictCode = GateCode | "NOT_ATTEMPTED" | `NETWORK_${string}`
  | "UNSUPPORTED" | "INVALID_ST" | "IDE_LOST_ITEM" | "DUPLICATE_CHILD" | "BAD_REQUEST" | "UNREADABLE" | "INTERNAL_ERROR"

type Path = string        // "<folder>/<name>.<kind>"; addressed case-insensitively, held exactly (F10)
type Version = string     // opaque

// ---- health / connect / disconnect ----
type Vendor = "codesys" | "twincat"
type RowStatus = "idle" | "healthy" | "degraded"                    // values from prose only (F3)
type ProjectEntry = { vendor: Vendor; version?: string; project: string; status: RowStatus; dirty: boolean }
type HealthResponse = {
  projects: ProjectEntry[]; networkText: boolean; protocol: number
  ideVersion?: string; productName?: string; productVersion?: string; productVendor?: string
  bridgeVersion?: string; unsupported?: string
  // `status` ("unavailable" | RowStatus) is described in prose but NOT in the schema (F4)
}
type ConnectRequest = { project?: string }
type OkResponse = { ok?: boolean }

// ---- reads ----
type Identity = { expectedPlatform?: Vendor; expectedProjectName?: string }
type RefsRequest = Identity & { knownItems?: Record<Path, Version>; knownApplications?: Path[] }
type ReadAnswer = {
  projectVersion: Version
  items: Record<Path, Version>
  applications: Path[]                       // application roots; longest prefix wins (F12)
  unreadable: { name: Path; reason: string }[]
  unreadableNodes: { name: string; reason: string }[]   // "<folder>/<name>", no kind
  removed: Path[]
  unwalkedFolders: string[]
  platform?: Vendor; projectName?: string
}
type RefsResponse = ReadAnswer
type FetchRequest = RefsRequest & { onlyItems?: Path[]; libraryManifestOnly?: boolean; init?: boolean }
type FetchedItem = { name: Path; sourceText: string; version: Version; unsupported?: { member?: string; language: string; reason: string }[] }
type FetchResponse = ReadAnswer & { changed: FetchedItem[]; librariesRefreshed: boolean }

// ---- push ----
type SetItemOp = { op: "set"; name: Path; to?: Path; sourceText?: string; ifVersion?: Version /* | null ? (F7) */ }
type DeleteItemOp = { op: "deleteItem"; name: Path; ifVersion?: Version }
type PushOp = SetItemOp | DeleteItemOp
type PushRequest = Identity & { ops: PushOp[]; expectedProjectVersion?: Version; force?: boolean; returnSources?: boolean }
type PushConflict = {
  name: string; reason: string; code?: ConflictCode       // prose: "every conflict carries one" (F6)
  yourVersion?: Version | null; currentVersion?: Version | null; line?: number
  partiallyApplied?: true; renamedTo?: Path; remains?: true
}
type PushResponse = {
  accepted: boolean; unwalkedFolders: string[]
  newProjectVersion?: Version; newItems?: Record<Path, Version>; conflicts?: PushConflict[]
  currentProjectVersion?: Version; newSources?: Record<Path, string>
}

// ---- build ----
type BuildRequest = Identity
type Severity = string                                   // values not in either file (F3)
type BridgeDiagnostic = { name?: Path; member?: string; code?: string; severity: Severity; message: string; line: number; column: number }
type BuildResponse = { success: boolean; duration: number /* unit? (F25) */; diagnostics: BridgeDiagnostic[] }
```

### 1.2 Request sequence

```ts
// 0. discover: enumerate \\.\pipe\ for prefix "volt.bridge.codesys." / "volt.bridge.twincat."
//    (several matches = several IDEs; how to pick is unstated — F14)
const pipe = await openPipe(`\\\\.\\pipe\\volt.bridge.codesys.${pid}`)

// call(): write one JSON line, read lines until a `result` or `error` frame; forward `progress`.
// Can a second request be written on the same connection after the terminal frame? Unstated (F2).

// 1. health first — gate on protocol before anything else (the bridge never checks the client, F15)
const h = await call<HealthResponse>(pipe, { op: "health" })        // or body: {} ? (F2)
if (h.protocol !== 1) throw new Error(`bridge speaks protocol ${h.protocol}`)
if (h.unsupported) throw new Error(h.unsupported)

// 2. connect to a project the health rows name
const row = h.projects[0]
await call<OkResponse>(pipe, { op: "connect", body: { project: row.project } })   // error frame PLC_DISCONNECTED if not served
const id = { expectedPlatform: row.vendor, expectedProjectName: row.project }

// 3. first pull
const f0 = await call<FetchResponse>(pipe, { op: "fetch", body: { ...id, init: true } })
let baseline = { items: f0.items, applications: f0.applications, projectVersion: f0.projectVersion }
// write f0.changed[] to disk; DO NOT treat items under f0.unwalkedFolders / f0.unreadable as deleted

// 4. later: cheap check, then incremental fetch
const r = await call<RefsResponse>(pipe, { op: "refs", body: { ...id } })
if (r.projectVersion !== baseline.projectVersion) {
  const f = await call<FetchResponse>(pipe, { op: "fetch", body: { ...id,
    knownItems: baseline.items, knownApplications: baseline.applications } })
  // apply f.changed, delete f.removed, keep everything under f.unwalkedFolders
}

// 5. push — one op per item; each op addressed by path
const A = "Device/Plc Logic/Application"
const p = await call<PushResponse>(pipe, { op: "push", body: { ...id,
  expectedProjectVersion: baseline.projectVersion,
  ops: [
    { op: "set", name: `${A}/FB_New.pou`, sourceText: "FUNCTION_BLOCK FB_New\n...\nIMPLEMENTATION ST\n..." }, // create: no ifVersion
    { op: "set", name: `${A}/PLC_PRG.pou`, ifVersion: baseline.items[`${A}/PLC_PRG.pou`], sourceText: "..." }, // update
    { op: "set", name: `${A}/GVL_Old.gvl`, ifVersion: baseline.items[`${A}/GVL_Old.gvl`], to: `${A}/GVL_New.gvl` }, // rename
    { op: "set", name: `${A}/T_Point.dut`, ifVersion: baseline.items[`${A}/T_Point.dut`], to: `${A}/Types/T_Point.dut` }, // move (folder created on demand)
    { op: "deleteItem", name: `${A}/FB_Dead.pou`, ifVersion: baseline.items[`${A}/FB_Dead.pou`] },              // delete
  ] } })
// MUST read both `accepted` and `conflicts`:
//   accepted:false  -> nothing applied (?? see F8), fix the named ops, resend
//   accepted:true + conflicts -> stopped mid-way; ops not named landed; NOT_ATTEMPTED ones resend unchanged
// update baseline from p.newItems / p.newProjectVersion — but the response has no `removed` (F9): re-run refs.

// 6. build (IDE_BUSY frame if a push/build holds the IDE; try once after it answers)
const b = await call<BuildResponse>(pipe, { op: "build", body: { ...id } })
```

---

## 2. Findings

Ordered by severity, then by how early a client meets them.

### F1 — BREAK — The OpenRPC document describes a JSON-RPC client the bridge does not speak
- wire.html#using: "a typed client is one command: `npx @open-rpc/generator`" … "What the document does **not** carry is the framing — newline-delimited `{op, body}` with a leading progress stream".
- OpenRPC `info.description`: "One request object per call: `{ "op": "<name>", "body": { ... } }`, answered with the method's result or `{ "error": … }`".
- Every method: `"paramStructure": "by-name"`, `"params": [{ "name": "body", … }]`.
- A generated OpenRPC client emits `{"jsonrpc":"2.0","id":…,"method":"fetch","params":{"body":{…}}}` and expects `{"jsonrpc","id","result"}` — none of which the bridge accepts. The info.description also says "answered with the method's result", which reads as an unwrapped result, while wire.html says `{"result": …}`.
- **Contract should say:** drop the "one command" claim, or ship the transport adapter. State in the OpenRPC `info.description` the exact frames: `{"result": R}` / `{"error": E}` / `{"progress": P}`, one per line. Add `x-framing` with the three frame schemas.

### F2 — BREAK — Connection lifetime, request multiplexing and the body of body-less ops are unstated
- wire.html: "A response is a run of frames on the same connection" — but not whether a connection carries one request or many, whether requests may be pipelined, whether a `health` may be sent on a second connection while a push runs on the first (it must be, for "safe to poll while a push … is running" to be usable), or how many pipe instances exist.
- `health`/`disconnect` have `"params": []`; wire.html's only request example has a `body`. BAD_REQUEST covers "a body that does not deserialize". Is `{"op":"health"}` valid, `{"op":"health","body":{}}`, `"body":null`?
- No request id, so a client that pipelines cannot correlate.
- **Contract should say:** "One connection carries requests sequentially; a new request may be written only after the terminal frame. Concurrent requests use separate connections (the server accepts N instances). `body` is optional and equals `{}` when absent."

### F3 — BREAK — The closed vocabularies are not in either file
- wire.html: `<td data-render="statuses">`, `data-render="severities"`, `data-render="vendors"`, `data-render="errors"`, `data-render="ops"`, `data-render="schemas"` — empty in the raw files.
- OpenRPC: `ProjectEntry.status`, `BridgeDiagnostic.severity`, `PushConflict.code`, the error frame's `code`, `expectedPlatform`, `platform`, `ProjectEntry.vendor` are all bare `"type":"string"` with no `enum`. Only `servers.variables.vendor` has an enum.
- Severity values: never written in prose at all (only "becomes `info`"). Row status values only in prose (`idle`, `healthy`, `degraded`; `unavailable` for the bridge).
- **Contract should say:** emit an `enum` for every closed vocabulary in the OpenRPC (it is generated, so this is free), and add a `BridgeErrorCode` / `ConflictCode` schema. For the `NETWORK_*` family, list it or state it is open and prefixed.

### F4 — BREAK — `HealthResponse.status` is documented but absent from the schema
- wire.html#vocab: "`HealthResponse.status` — `unavailable` + the above. The BRIDGE-level aggregate."
- OpenRPC `health` x-outcomes: "A bridge serving nothing is the aggregate status `unavailable` instead."
- OpenRPC `HealthResponse.properties`: no `status`.
- **Contract should say:** either add `status` (required, enum) to `HealthResponse`, or delete the aggregate from prose and say "serving = some row's status != idle".

### F5 — BREAK — Per-op `x-errorCodes` is called a closed set but omits codes the prose assigns to every op
- wire.html#ops: "Each card carries the **closed set of error frames** that op can answer with".
- wire.html BAD_REQUEST: "A request frame that is not valid JSON, a body that does not deserialize, a body member the op does not have … an unknown `op`" — i.e. any op. Every request schema has `"additionalProperties": false`.
- `x-errorCodes` for `health` = [INTERNAL_ERROR], `connect`, `disconnect`, `refs`, `push`, `build`: no BAD_REQUEST. `build` has no INTERNAL_ERROR ("essentially never" is not "never") and no ITEM_UNVERIFIED although "Resolving a body's names reads every declaration of the project, so such a folder anywhere refuses that op too" (which op?).
- `disconnect` x-outcomes: "Fails only with IDE_UNSUPPORTED" — but a malformed disconnect must be BAD_REQUEST.
- **Contract should say:** a common set every op may answer (BAD_REQUEST, INTERNAL_ERROR), listed once, plus the op-specific set. Fix `build`'s list to match what it can answer, and state which op the "folder anywhere" refusal applies to.

### F6 — BREAK — `PushConflict.code` is optional in the schema, mandatory in prose
- wire.html#partial-push note: "Match `conflicts[].code`, never the message … Every conflict carries one."
- OpenRPC `PushConflict.required`: `["name","reason"]`.
- A strict decoder generated from the schema types it `code?: string`, so clients write a `?? fallback` branch for a case the bridge says never happens.
- **Contract should say:** `required: ["name","reason","code"]`, with `code` an enum (F3).

### F7 — BREAK — Create vs update is decided by `ifVersion` presence, which nothing states; `null` is not in the schema
- wire.html set op: "A path that names no item is a create there." (state of the IDE decides.)
- wire.html ITEM_EXISTS: "a create (`ifVersion: null`, gate only, so a forced create overwrites)".
- wire.html ITEM_MISSING: "You quoted a version for an item that is gone."
- OpenRPC `SetItemOp.ifVersion`: `"type":"string"` — `null` is not valid; absent vs null undefined.
- So the real rule is: absent/null `ifVersion` = "I expect nothing there" (ITEM_EXISTS if something is), a string = "I expect this version" (STALE_ITEM_VERSION / ITEM_MISSING). A client that omits `ifVersion` on an update — a natural reading of "path names an item → update" — gets ITEM_EXISTS. Also unstated: `deleteItem` without `ifVersion` (guarded? unconditional? ITEM_EXISTS?), and a `deleteItem` of a path that names nothing.
- **Contract should say:** a table of (`ifVersion` absent | string) × (item present | absent) × (`force`) → outcome, for both arms. Use one spelling for "no version": absent (schema) — drop `null` from prose, or make the schema `["string","null"]`.

### F8 — BREAK — `accepted:false` means "nothing applied" in one section and "partly applied" in another
- wire.html#gate-codes: "A rejected push is … a normal `result` with `accepted:false` … Nothing was applied."
- wire.html#partial-push: "When the refused op was the first one applied, nothing landed in full and the answer is `accepted:false`; whatever of that op the IDE kept (an update's declaration, a member it deleted, a create it could not remove) is stated in its reason."
- OpenRPC push x-outcomes: "`partiallyApplied: true` whenever any of it stays", "`remains: true` for a create whose rollback failed".
- Further: on that `accepted:false`, are the later ops listed? `NOT_ATTEMPTED` is "Only on an accepted push", and "Every op the list does not name landed" is said only for `accepted:true`. A client applying the gate-section rule ("nothing applied; fix the named ops and resend the rest") resends after a half-applied first op — exactly what `partiallyApplied` warns against. Is `newProjectVersion` present on that answer?
- **Contract should say:** `accepted` = "at least one op landed in full". One rule for both: every op not named in `conflicts` landed; every unlanded op is named (later ones `NOT_ATTEMPTED` regardless of `accepted`); `partiallyApplied` on any conflict means the IDE changed — re-read before resending. State which receipt fields are present for each `accepted` value.

### F9 — BREAK — The push answer cannot update a client's baseline without a second read
- Read side: `items`, `removed`, `applications`, `unreadable`, `unwalkedFolders` (all required).
- Write side `PushResponse`: `newItems` (optional; whole map or only touched items?), `newProjectVersion` (optional), `unwalkedFolders` (required — meaning on a push never stated), no `removed`, no `applications`.
- After a rename/move/delete the client cannot tell from `newItems` alone whether the old path is gone unless `newItems` is the complete map. `currentProjectVersion` and `newSources`/`returnSources` have no prose at all.
- **Contract should say:** `newItems` is the full `items` map after the push (or: the touched items, with a `removed` list), state when each receipt field is present, define `currentProjectVersion` (presumably: on STALE_PROJECT_VERSION, the IDE's current one), define `returnSources` → `newSources` (which items, keyed how), and what `unwalkedFolders` on a push answer means.

### F10 — BREAK — Case-insensitive addressing has no stated comparison rule
- wire.html#identity: "A path you address (`onlyItems`, a push op's `name` and `to`) finds the IDE item ignoring case, and every answer spells it as the IDE does. A key you hold (`knownItems`) is exact".
- Not stated: which fold (ordinal-ignore-case? invariant culture? Unicode simple fold?) — `İ`/`ı`, `ß`, Cyrillic are real (Turkish/Russian customers). Not stated: does "one op per item" compare ignoring case (is `set a.pou` + `deleteItem A.pou` two ops on one item)? Is a `to` that differs from `name` only by case a rename (case-only rename)? Is `knownApplications` exact or ignoring case? Does `applications` prefix matching ignore case?
- A client that keys its own maps by the path it SENT will miss answers spelled differently (onlyItems `fb_motor.pou` → answer `FB_Motor.pou`).
- **Contract should say:** "Addressed paths compare by ordinal case-insensitive (culture-invariant simple case folding). The one-op-per-item rule uses the same comparison. A `set` whose `to` equals `name` ignoring case but not exactly is a case-only rename. Clients must key answers by the answer's spelling."

### F11 — BREAK — Is an unreadable item in `items` or not?
- wire.html#identity: "`unreadable` lists the items the walk found and did not read, each `{ name, reason }` with `name` the path the item has in `items` while it reads" — implies: absent from `items` while unreadable.
- OpenRPC `refs` x-outcomes: "it is named in `unreadable`, keeps a stable sentinel version so a pull does not mistake it for deleted" — implies: present in `items`, with a sentinel version.
- A client diffing `items` against its baseline deletes the file under the first reading, and pushes the sentinel as `ifVersion` under the second (wire.html UNREADABLE: "there is no version to compare against … push with `force`").
- Also: is the sentinel in `projectVersion`? Does it appear in `removed`? Is it a recognisable value?
- **Contract should say:** one of the two, explicitly: "An unreadable item is in `unreadable` and NOT in `items`/`removed`; a client keeps its file" — or "is in `items` with version `<sentinel>`; never quote it as `ifVersion`".

### F12 — BREAK — "Longest prefix" is not defined as segment-wise
- wire.html: "An item belongs to the application whose root is the longest prefix of its path; an item under none belongs to the pool."
- With roots `A/App` and an item `A/App2/X.pou`, a string `startsWith` assigns it to `A/App`. Also unstated: case (F10), whether a root itself can be an item path, and what the TwinCAT root looks like (only CODESYS-shaped examples are given beside it).
- **Contract should say:** "the root equals the path's leading `/`-separated segments", with one TwinCAT example root.

### F13 — BREAK — Path grammar and the kind-extension set are not in the wire contract
- wire.html: `<folder>/<name>.<kind>`; "an op under a name with no kind extension — `X`, `X.foo` … — is refused BAD_REQUEST". The valid kinds are only behind a link (`items.html`); in these two files a stranger meets `.pou`, `.dut`, `.gvl`, `.visualization`, `.library`, `.task`, `.projectsettings` by example.
- Unstated: can a name contain `.` (`My.Fb.pou` — kind = last segment?), `/`, leading/trailing spaces? Is the separator always `/`? Is there a root folder spelling (empty folder = `Project Settings.projectsettings`)? Which kinds are writable — "a push of a read-only descriptor" is BAD_REQUEST but the read-only ones are not named here.
- **Contract should say:** a path grammar (segments, separator, kind = text after the last `.` of the last segment, no escaping, or the escaping rule), and an enum of kinds with a writable flag in the OpenRPC (`x-itemKinds`).

### F14 — MISUSE — Discovery by prefix with several matches
- wire.html: "Clients discover by prefix, because the pid changes on every IDE restart." OpenRPC `pid.default: "0"`.
- Two CODESYS windows → two pipes. `health` has no pid field to correlate. Is a stale pipe possible? The default `"0"` suggests a pipe `volt.bridge.codesys.0` exists.
- **Contract should say:** "several pipes of one vendor are several IDEs; choose by `health.projects[].project`"; drop the `"0"` default or say it never exists.

### F15 — MISUSE — Protocol negotiation is one-sided and the number is spelled two ways
- wire.html: "`health.protocol` is the wire protocol … the number the relay `hello` and this document's `info.version` carry … The CLI sends no op to a bridge of another number, absent included (`BRIDGE_PROTOCOL`, cli)".
- OpenRPC: `info.version: "1"` (string), `health.protocol` integer, required (so "absent included" contradicts `required`).
- The bridge never learns the client's protocol (no field in any request), so a foreign client that skips the check gets silent meaning drift — the case the rule exists for. `BRIDGE_PROTOCOL` is a CLI code; a foreign client cannot tell whether the bridge ever emits it. "the relay `hello`" is undefined in these files.
- The rule "changes when an old peer would read the new wire without refusing it" + `additionalProperties:false` on requests means an additive request field is refused by an old bridge (good) — but nothing says a client MUST ignore unknown RESPONSE fields, which is what makes additive response fields safe.
- **Contract should say:** "A client MUST call `health` first and send nothing else unless `protocol` equals a number it implements. Clients MUST ignore unknown response members and unknown frame keys." Spell `info.version` as the same integer; remove `BRIDGE_PROTOCOL` and `hello` from this page or define them.

### F16 — MISUSE — `ITEM_EXISTS` conflicts may name an item that is not the op's
- wire.html ITEM_EXISTS: "… a create or a rename onto a name a POU, DUT or GVL of the same application holds in another folder or kind … (the conflict names that item)".
- wire.html#gate-codes: "names every refused op … in request order, one conflict per op — so a client regenerates exactly those".
- If `conflict.name` is the OTHER item's path, a client mapping conflicts back to ops by `name` finds no op, or the wrong one. Same for the `<project>` row of STALE_PROJECT_VERSION (is it the literal string `<project>`?).
- **Contract should say:** `conflict.name` is ALWAYS the op's `name`; the colliding item travels in its own field (e.g. `existing`). State that `<project>` is the literal string.

### F17 — MISUSE — Which bare names share one IDE namespace is underspecified
- wire.html#push-ops note: "`X.pou` and `X.dut` are two items, but ONE IDE object name … a `deleteItem` of one beside a `set` of the other is a re-type in one push, and is refused".
- wire.html ITEM_EXISTS: "a POU, DUT or GVL of the same application … since the IDE holds one object of a name per application".
- wire.html#identity (and the real case): `CM_Carrier.pou` and `CM_Carrier.visualization` coexist in one folder.
- So the shared namespace is {POU, DUT, GVL} per application, but visualizations, interfaces, tasks, libraries are not mentioned either way. A client pre-validating will be either too strict or too loose.
- **Contract should say:** the list of kinds that share the per-application name namespace (as data, from the generator).

### F18 — MISUSE — `%CLASS` vs "a POU's kind is never read" contradict each other
- wire.html#pou: "a push that changes what a POU's text declares — a PROGRAM rewritten as a FUNCTION_BLOCK — is an ordinary content update … The text is written as sent and never read for a kind."
- wire.html#push-ops note: "a create makes the class its `%CLASS` line names or is refused UNSUPPORTED … an update whose `%CLASS` differs from the IDE's is refused the same way (a class never changes in place — delete and create it, two pushes)."
- wire.html#dut: "A DUT op's body is **not** checked against anything" vs INVALID_ST: "a `%`-line out of place, out of order, repeated, or with a value it does not take" — yet "a DUT or a GVL is never refused by it".
- Without items.html a stranger cannot tell whether `%CLASS` is the PROGRAM/FB distinction (then the PROGRAM→FB update is refused) or something else. Are `%`-lines in a DUT/GVL validated or not?
- **Contract should say:** what `%CLASS` distinguishes, with one example, and one sentence for which kinds' `%`-lines are validated.

### F19 — MISUSE — "applied atomically" vs a rename that survives a refused set
- wire.html set: "One op expresses create, update, rename, move … applied atomically."
- OpenRPC push x-outcomes: "`renamedTo` with the item's current full name after a native rename that ran first".
- **Contract should say:** a `set` is not atomic in the IDE; on refusal `renamedTo` names where the item now is. Drop "atomically", or define it as "one op, one conflict".

### F20 — MISUSE — Request order vs apply order
- wire.html: "A push carries an ordered list of ops" … "each op after it in **apply order** with `NOT_ATTEMPTED`" … "in **request order**, one conflict per op".
- If the bridge reorders (e.g. deletes first), a client cannot predict which ops landed when one is refused, and "ordered list" suggests order has meaning (it can't — "freeing a path and moving onto it" must be two pushes).
- **Contract should say:** "ops are independent; order carries no meaning; the bridge applies in request order" — or define the apply order.

### F21 — MISUSE — `fetch` argument combinations
- BAD_REQUEST: "a `fetch` with neither `knownItems` nor `onlyItems` nor `init: true`". wire.html's framing example: `{ "knownItems": {}, "onlyItems": [ … ] }`.
- Unstated: does `knownItems: {}` count as present (then it is exactly the "forgot its baseline" case the rule forbids)? `init:true` with `knownItems`? `onlyItems` + `knownItems`: is `changed` the intersection? Under `onlyItems`, is `items` the full map or the subset, and is an `onlyItems` path that names nothing in `removed`, in `changed` absent, or refused? `libraryManifestOnly` without a `.library` in `onlyItems`? `librariesRefreshed` has no meaning stated (only when it is NOT set). `refs` accepts `knownItems` too (and has no `init`): what does `refs` do with them — only compute `removed`?
- A `.library` fetch "returns its manifest and every signature of that library, in the folder" — as several `changed` entries under paths not in `items`? How does a client tell them from items?
- **Contract should say:** a combination table for `fetch` (and `refs`), and the meaning of `librariesRefreshed`. Use a request without `knownItems: {}` in the framing example.

### F22 — MISUSE — `knownApplications` and the unwalked-folder rules
- wire.html: "A client that sends `knownItems` also sends the `applications` its baseline was read with, as `knownApplications`: a known path under a folder the walk could not read is then judged by the application it was in."
- Optional in the schema; the consequence of omitting it is not stated; "judged by" is undefined.
- `unreadableNodes`: "an object whose kind the IDE could not state (its folder and subtree are then in `unwalkedFolders`)" — the PARENT folder of the object, or the node path itself?
- **Contract should say:** required-when (`knownItems` ⇒ `knownApplications`, enforced as BAD_REQUEST), what the bridge does with it in one sentence, and "its parent folder" or "the node path" for unwalkedFolders.

### F23 — MISUSE — `null` vs absent is inconsistent
- STALE_ITEM_VERSION: "`yourVersion` and `currentVersion` are both set"; ITEM_MISSING: "`currentVersion` is null".
- OpenRPC push x-outcomes: flags are "ABSENT when it does not apply — never false".
- Schema: every optional is `"type":"string"`, never nullable. A zod/strict decoder rejects `null`.
- **Contract should say:** one rule — absent, never null — and fix ITEM_MISSING's wording (or make the schema nullable).

### F24 — MISUSE — Same code, two channels
- `ITEM_UNVERIFIED`: a gate conflict, an apply-time conflict, AND an error frame on refs/fetch/push.
- `BAD_REQUEST`: an error frame (malformed request) AND a conflict ("The push's op routing"). wire.html#gate-codes: "a malformed request (BAD_REQUEST for the ops' own shape) at its first offending op" — frame or conflict? A push op missing `name` (schema-required) fails deserialization → frame?; a name with no kind extension → conflict. Where is the line?
- `UNSUPPORTED`: "Also raised on a READ … (the item is listed `unreadable` naming the member)" — but `UnreadableItem` has no `code`, so on the read side the code never reaches the client.
- **Contract should say:** for each code, the channel(s) it arrives on, as a column in the table (data-driven). Give `UnreadableItem`/`UnreadableNode` a `code` if the read side has codes.

### F25 — MISUSE — Build diagnostics underspecified
- `BridgeDiagnostic.line`/`column` required integers: 1- or 0-based? What value when the vendor has no position? `name` optional although wire.html#identity says "a build diagnostic … keyed by it [the path]" — when absent? `member` spelling? `code` (e.g. `C0032`) — optional when?
- `BuildResponse.duration`: unit not stated (ms or s).
- OpenRPC build x-outcomes: "`success` comes from a different vendor SIGNAL on each" — so can `success:true` coexist with `error` diagnostics on one vendor and not the other? That is a wire divergence the contract admits without a rule.
- Build side effect: "On TwinCAT a build saves changed documents" vs push "saves nothing, on both vendors" — another stated divergence.
- **Contract should say:** base of line/column and the "no position" value, `duration` in ms, when `name` is absent, and one rule relating `success` to diagnostics on both vendors.

### F26 — MISUSE — Encoding and text normalisation
- Not stated: UTF-8 (with/without BOM), line ending of the frame (`\n` vs `\r\n`), line endings inside `sourceText` (CRLF vs LF) and whether a client changing them changes the item version or is a content change.
- **Contract should say:** "frames are UTF-8 without BOM, terminated by `\n`; `sourceText` uses `\n`/`\r\n` (pick one) and versions are over that exact text".

### F27 — MISUSE — Lease and identity checks when the fields are absent
- `expectedProjectVersion`, `expectedPlatform`, `expectedProjectName` are all optional. Prose: "`force` drops the per-item checks and keeps the lease". A forced push without `expectedProjectVersion` is therefore fully unguarded, and a request without identity fields cannot get WRONG_PROJECT. Not stated whether absent = "no check". Name comparison (exact / case) not stated.
- **Contract should say:** absent = no check, explicitly, per field; and whether a client SHOULD always send them.

### F28 — MISUSE — `health` fields with no meaning given
- `networkText` (required): what changes when false — graphical bodies arrive as `IMPLEMENTATION … UNSUPPORTED`? pushes of them refused? fetch summary says "Graphical bodies arrive as network text" unconditionally.
- `ProjectEntry.version`, `ProjectEntry.dirty`: undefined. `ProjectEntry.project`: is it the exact string `connect` and `expectedProjectName` want?
- `connect` result `{ ok?: boolean }`: a refusal is an error frame, so can `ok` ever be false? "An absent or empty `project` means 'serve whatever you have'" — with two projects listed?
- **Contract should say:** one line each; `ok` always `true` (or drop the result to `{}`).

### F29 — MISUSE — Progress frames are not in the schema and the formula divides by an optional field
- wire.html: "`total` (absent means indeterminate — a build) … `(phaseIndex + done/total) / phaseCount`". No `ProgressFrame` in OpenRPC components although wire.html#schemas says "Every type that travels on the wire". `operation` values and phaseIndex base (0?) not stated.
- **Contract should say:** a `ProgressFrame` schema; phaseIndex 0-based; formula only when `total` present.

### F30 — MISUSE — Folder pruning: "never a vendor container"
- wire.html: "Only folders *that push* emptied, recursively up the chain, and never a vendor container."
- A client cannot tell from a path which segments are vendor containers (`Plc Logic`, `Application`, `POUs`?) — so it cannot predict the resulting tree, nor whether a move INTO a vendor container (or creating an item directly in one) is allowed.
- **Contract should say:** vendor containers are the application roots and their ancestors (if so), or list them via `refs`.

### F31 — MISUSE — A `set` with neither `to` nor `sourceText`
- `SetItemOp` requires only `name`. `to ?? name`, `sourceText ?? (what it has now)` — so `{op:"set",name:X,ifVersion:v}` is a no-op on an existing item and BAD_REQUEST on a missing one ("a create with no `sourceText`"). Is the no-op allowed, counted in the one-op rule, version-checked?
- **Contract should say:** a no-op set is refused BAD_REQUEST, or is a pure version assertion — state which.

### F32 — COSMETIC — `delete` is not an op name
- wire.html#dut: "A `delete` names one wire item by its kind: `delete X.dut` never deletes an `X` that is a POU". The op is `deleteItem`. A reader grepping the op names finds two spellings.
- **Contract should say:** `deleteItem` throughout.

### F33 — COSMETIC — Stale summaries in the OpenRPC
- `refs.summary`: "every tracked item's version, its folder, and the aggregate project/structure versions" — `RefsResponse` has no folder field and no structure version; only `projectVersion`. Does `projectVersion` cover paths/structure (a rename) or only content ("Every tracked item's content, aggregated")?
- **Contract should say:** "path → version map and `projectVersion`, which changes on any content OR path change" (whichever is true).

### F34 — COSMETIC — History and internal names in a contract
- History: "(It was `NOT_FOUND`.)", "(It was `INTERNAL_ERROR`.)", "(It was NO_SIDECAR, a code named after a cache no client sees.)", "That batch used to replace the object", "CODESYS used to run the op nested inside the running build", the whole "Until 2026-09 this field held the network-text code …" paragraph, "The retired names `X.prg` / `X.fb` / `X.fun`" and "the retired split names `X.struct` …".
- Internal identifiers a client cannot use: `WireProtocol.Version`, `PipeServer`, `ConflictFor`, `BridgeErrorCodes`, `DocDataTests`, DIALECT `C2i`/`D34`/`D45`, "logged at Warn", "The guard sits OUTSIDE the try", "the post-condition is enforced in shared code".
- **Contract should say:** current behaviour only; refused spellings appear only as the error they get today (one row in the error table).

### F35 — COSMETIC — "a reason carries no client instruction" vs reasons that instruct
- wire.html#partial-push: "A reason describes the refusal and carries no client instruction".
- wire.html UNREADABLE: "the refusal says so: fix it in the IDE, or replace it — push its `deleteItem`, then push it again as a create".
- **Contract should say:** move the advice to the "what a client does" column only.

### F36 — COSMETIC — "Seven" counted three ways
- "Seven ops over a Windows named pipe" (7 methods incl. connect/disconnect — consistent), "Seven of these codes are raised in places whose exceptions the push catches", "the seven bridge codes in the table before it", "These five are the gate's own answers". Counts in prose drift when a code is added; the tables are the truth.
- **Contract should say:** drop the counts.

---

## 3. What would most help a second client

1. Generate the frames, the error/conflict code enums, every closed vocabulary, the kind list and each code's channel into the OpenRPC (F1, F3, F5, F6, F24) — it is already generated from the C# types, so drift is impossible once it is there.
2. One table for push outcomes: `ifVersion` × presence × `force` × arm (F7), and one rule for `accepted` (F8).
3. A push receipt that updates a baseline without a second read (F9).
4. A precise comparison rule for addressed paths and application prefixes (F10, F12), and a path grammar (F13).
5. Resolve the unreadable-in-`items` contradiction (F11).
