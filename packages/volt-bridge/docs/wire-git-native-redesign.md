# Bridge wire — git-native redesign

**Status:** `/push` **IMPLEMENTED** (the `set` op — both sides, tested); `/refs` list **deferred to
graduation** (it would touch volt-cli's read path, the fallback — cleaner once volt-cli is deleted).
**Driver:** make the git sync layer (`packages/volt-git`) the easiest thing in the system to maintain ·
**Owner of the contract:** `Volt.Bridge.Core` (both vendors serve it byte-identically)

> **Implemented (`/push`):** `Volt.Bridge.Core` `Wire/PushModels.cs` (`SetItemOp` + `DeleteItemOp` only —
> the legacy pushItem/rename/move ops were **removed**, clean cutover, no backward compat), `Sync/PushService.cs`
> (one `ApplySetItem` apply path; `DetectConflicts` unified; `ApplyOp` 2 branches). IDE contract + both vendors
> **unchanged**. volt-git `bridge/types.ts` (`PushOp = set | delete`) + `sync/push.ts` (one op per diff row;
> `cleanStructural` + the rename+edit/rename+move refusals **deleted** — they now succeed as one `set`).
> openapi spec bumped to **2.0.0**; C# + volt-git + e2e tests all on `set`. **rename+edit and rename+move
> now just work** — validated live against real CODESYS (create/rename+edit/move/delete).

## Why this exists

`volt-git` syncs the IDE by treating the workspace as a git repo: it computes a **tree diff** (old →
new) and applies it. git's data model is **declarative snapshots** — a commit is a set of `path → content`,
and a "rename" is *not stored*; git infers it at diff time by content similarity (`git diff -M`).

Today's `/push` is the opposite — an **imperative CRUD API** (`pushItem` / `deleteItem` / `renameItem`
/ `moveItem`). So `volt-git` has to **re-encode** a declarative tree-diff into discrete operations. That
re-encoding is *the* maintenance cost, and it's where the hard limitations live (rename+edit and
rename+move can't be expressed and are refused). This doc proposes the minimal wire reshape that makes
the git layer map **1:1** to the wire — no re-encoding, no impossible cases.

> Scope: the **write** path (`/push`) is reshaped; the read path gets one ergonomic tidy. `/health`,
> `/fetch`, `/build`, optimistic concurrency, and the "item name is the identity" invariant are
> **unchanged**. (TC/CODESYS enforce globally-unique names, so name = a safe identity; path = folder/name.)

---

## Current wire (imperative CRUD)

```
GET  /health → { status, platform, projectName, plcProjectName, connected, … }

GET  /refs   → { projectVersion, structureVersion,
                 items:   { "FB_X.st": "v1", "PLC_PRG.st": "v3", … },   ← name → version
                 folders: { "FB_X.st": "POUs",  "PLC_PRG.st": "",  … } } ← name → folder   ⟵ PARALLEL map
                                                                            (volt-git re-joins → path)
POST /fetch  { knownItems } → { projectVersion, structureVersion,
                 changed: [ { name, folder, sourceText, version } ], removed: [ name ], items }

POST /push   { expectedProjectVersion, ops: [
                 pushItem   { name, folder?, sourceText, ifVersion },   ┐
                 deleteItem { name, ifVersion },                        │  4 ops…
                 renameItem { name, newName,   ifVersion },             │  …3 of which are
                 moveItem   { name, newFolder, ifVersion } ] }          ┘  "the item changed"

POST /build  { buildType } → { success, duration, diagnostics }
```

**Friction, per endpoint**

| Endpoint | Fit | What the git layer has to do |
|---|---|---|
| `/health` | ✅ | nothing |
| `/refs` | ⚠️ | re-join two parallel maps (`items` + `folders`) into paths on every call; `structureVersion` unused (git's tree *is* the structure) |
| `/fetch` | ✅ | fine (already per-item with `folder`); `knownItems` delta unused (git rebuilds the whole tree) |
| `/push` | ❌ | **re-encode the tree-diff into 4 op types**: run `git -M` to *reconstruct* renames; classify each as rename vs move vs edit; **can't express rename+edit or rename+move** (two ops on an identity changing mid-batch) → currently **refused** |
| `/build` | ✅ | nothing (one nit already handled: a `column` diagnostic field) |

---

## The mismatch in one line

> A **rename**, a **move**, and an **edit** are three views of a single fact — *"this item's path and/or
> content changed."* The wire models them as three ops; git models the whole thing as one tree-diff row.
> Three ops for one fact is the smell — and the combinations (rename+move, rename+edit) fall in the gaps
> between the ops.

git itself has **no rename op** — proof that the snapshot model doesn't need one. The IDE *does* need to
know "this is a rename" (to preserve references), so the wire must carry that **hint** — but it should be
*one* atomic statement of the new state, not a decomposition the client has to assemble.

---

## Ideal wire (declarative item-state)

```
GET  /health → (unchanged)

GET  /refs   → { projectVersion, items: [ { name, folder, version }, … ] }   ⟵ ONE list, not two maps

POST /fetch  → (unchanged — already per-item)

POST /push   { expectedProjectVersion, ops: [
                 set    { name, toName?, toFolder?, sourceText?, ifVersion },   ⟵ ONE op, every case
                 delete { name, ifVersion } ] }

POST /build  → (unchanged)
```

### The `set` op — one op, every case

`set` states the item's **new** identity + content in a single atomic transaction. Every field except
`name` and `ifVersion` is optional; *absent = unchanged*.

| Field | Meaning |
|---|---|
| `name` | the item's **current** identity (or, on create, the new name) |
| `toName?` | present iff **renamed** → the new name |
| `toFolder?` | the item's folder — set on **create**, or the new folder on **move**; absent = folder unchanged |
| `sourceText?` | present iff **content** changed |
| `ifVersion` | `null` = create · `string` = update guard (optimistic concurrency, unchanged) |

The bridge applies one `set` as a transaction: **rename/move first** (so the IDE preserves references),
then set content. `delete` stays its own op — it's the one verb with no identity/content to carry.

### It maps 1:1 to `git diff -M` (the maintenance win)

`volt-git` already computes exactly `(oldPath, newPath, content)` per changed item. Each row becomes **one** op:

| git diff row | → wire op |
|---|---|
| `A` add | `set { name, toFolder: folder, sourceText, ifVersion: null }` |
| `M` modify | `set { name, sourceText, ifVersion }` |
| `R` rename (name) | `set { name: old, toName: new, ifVersion }` |
| `R` move (folder) | `set { name, toFolder: new, ifVersion }` |
| `R` rename **+** move | `set { name: old, toName: new, toFolder: new, ifVersion }` |
| `R` rename **+** edit | `set { name: old, toName: new, sourceText, ifVersion }` |
| `D` delete | `delete { name, ifVersion }` |

No client-side rename **classification**, no **decomposition**, no **impossible combinations**, no
**refusals**. The push side of `volt-git` collapses from "diff → classify rename/move/edit → reject the
unexpressible → emit 1–2 ops" down to **"each diff row → one op."**

```
volt-git push.ts today                          volt-git push.ts with `set`
──────────────────────                          ───────────────────────────
diffRows(-M)                                     diffRows(-M)
+ cleanStructural() XOR check                    for each row → one set/delete op
+ "unsplittable" pre-pass refusal                (done)
+ rename-vs-move branch
+ delete+add for the rest
≈ 60 lines, 2 refusal paths                      ≈ 12 lines, 0 refusal paths
```

---

## What stays exactly the same

- **Optimistic concurrency** — `ifVersion` per op + `expectedProjectVersion` per batch. Untouched.
- **Atomic batch** — all-or-nothing with forward simulation. Untouched (and now *more* useful: rename+edit
  is one op, so no cross-op version puzzle).
- **`/fetch`, `/health`, `/build`** — unchanged.
- **Name = identity** invariant — unchanged (unique names make it sound; `set` still keys by `name`).
- **Graphical bodies** — still transpiled to read-only ST on `/fetch`; never pushed.

---

## Migration & impact

**Bridge (C#)** — `Volt.Bridge.Core` wire types + the apply logic; both vendor bridges; the parity tests.
The apply logic *shrank* (one `set` handler replaced three op handlers, sharing the rename→move→content
sequence). Shipped as a **clean cutover** — the legacy ops were removed outright (no backward compat) and
the openapi spec bumped to 2.0.0.

**Git layer (`volt-git`)** — `push.ts` collapses to "one op per diff row" (delete the `cleanStructural`
helper + the unsplittable pre-pass + the rename/move branch). `status.ts`/`refs.ts` read `/refs` as a
list (drop the parallel-map re-join). `bridge/types.ts` updates the schemas. Net: **less** code.

**Other clients** (volt-vscode SCM, the desktop panel) — unaffected: they go through `volt-control`,
which spawns the CLI; the wire change is below them. A GUI that wants imperative "rename this" just sends
`set { name, toName }` — the unified op serves the imperative client *and* the git client equally.

---

## Recommendation

Make exactly two changes, both load-bearing for maintainability:
1. **`/push`: replace `pushItem`+`renameItem`+`moveItem` with one `set` op** (keep `delete`). This is the
   change that dissolves the rename+edit / rename+move refusals and halves the push code.
2. **`/refs`: return one `[{name, folder, version}]` list** instead of two parallel maps (ergonomic).

Everything else about the wire is already a good fit for git-native sync — the imperative `/push` is the
single thing shaped against the grain.
