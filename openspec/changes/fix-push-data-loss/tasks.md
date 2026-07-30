## 1. Bug 1 — a read-only graphical child was flattened on push (DONE)

- [x] 1.1 Red first: `test/Volt.Engine.Tests/sync/GraphicalChildGuardTests.cs` — 7 tests covering the marker
      round-trip, real text over a CFC/SFC child, text over an FBD/LD child, and a control that an ordinary textual
      child still pushes. **6 of 7 failed before the fix, with "no exception was thrown"** — i.e. the push silently
      succeeded and overwrote the body. That is the data loss, captured offline.
- [x] 1.2 `Materializer.IsGraphicalBodyMarker`, derived from the same literal `GraphicalBodyMarker` writes so reader
      and writer cannot drift.
- [x] 1.3 `PushService.RequireChildFormatWritable` — the child-level counterpart of the root guard, deciding from the
      live `BodyLanguage` and mirroring its three cases. Scoped to method/action children: an interface member has no
      body of its own (reading one crashes TwinCAT) and a PROPERTY node's body lives in its GET/SET accessors.
- [x] 1.4 Run it as a **pre-pass over all children before any write**, so a refusal is atomic. (Found while fixing:
      validating inside the apply loop left the root body already written when a child was refused.)
- [x] 1.5 Gate: build 0 errors · **324**/324 (317 + 7) · 116/116 · 76/76 · live CODESYS e2e **92 pass / 0 fail**.

> Two test-authoring facts worth keeping, both cost a cycle: a `SetItemOp` with `IfVersion == null` means **create**,
> so pushing an existing item that way yields a conflict and never applies — read the real version from
> `RefsService` first. And `FakeIde` items carry **bare** names; the extension comes from the kind during
> materialization, and ops are bare-keyed internally.

## 2. Verify bug 1 on the other vendor

- [ ] 2.1 Live TwinCAT e2e (`bun run test:e2e:twincat`) — Core is shared so the guard is vendor-neutral, but the
      `BodyLanguage` read goes through `TcPouReader`, so prove it on a real XAE. **Point the connector at a freshly
      built worker via `VOLT_TWINCAT_BRIDGE`** or you will be testing the stale installed one.
- [ ] 2.2 Ideally an e2e case with a real CFC method child in a fixture — the unit tests use `FakeIde`'s
      `BodyLang`, which is a model of the vendors' behaviour, not the behaviour itself.

## 3. Bug 2 — a pushed item does not survive the IDE being killed (OPEN)

- [ ] 3.1 **Separate "never saved" from "saved but not reloaded" first** — the cheapest decisive experiment: push an
      item, then WITHOUT killing anything, check whether it exists on disk under `test/TwinCAT Project14/`. That one
      observation eliminates half the candidate causes.
- [ ] 3.2 Check the push path's `FlushPendingWrites` call: is it invoked at all, and is it invoked AFTER the child
      writes rather than before? (`IIdeSession` documents "after applying a push".)
- [ ] 3.3 Read `%LOCALAPPDATA%\Volt\logs\twincat-*.log` across a push + kill + reopen. With the health probe no
      longer swallowing failures (`fix-connected-precondition`), a failing save should now be visible.
- [ ] 3.4 Candidate causes, in order: SaveAll not invoked / invoked too early; SaveAll saves the PLC project but not
      the item's containing artifact; the reopened XAE loads a cached copy; the kill races the save.
- [ ] 3.5 Fix, with a red-first test. Prefer a unit-level test on the call ORDER if the cause is ordering — that is
      cheap and does not need an IDE.
- [ ] 3.6 **`ide-restart` to 2 pass / 0 fail**, assertions intact. It is currently 1 pass / 1 fail and stays red
      until this is fixed — do NOT weaken it.

## 4. Scope the TwinCAT save to what Volt wrote (DECIDED 2026-07-30, not yet implemented)

**Decision:** `push` stays durable — a push that reports success must be on disk — but it must NOT commit the
engineer's unrelated work. `Solution.Save()` + `Documents.SaveAll()` saves every open editor, which is a side effect
on data Volt does not own.

Why it isn't done yet: a TwinCAT write targets a **system-manager tree node** (`n.DeclarationText` /
`n.ImplementationText`), and that node exposes no DTE document or file path — so the mapping from touched node to
the document/project to save has to be established against the live COM model. Guessing it would be worse than the
current broad save, which at least keeps push durable (CODESYS commits on write, so dropping the save entirely
would make `push` durable on one vendor and not the other — an observable per-vendor difference).

- [ ] 4.1 Live probe: for a POU tree node, find what identifies its file — walk `_dte.Solution.Projects` /
      `ProjectItems` and correlate with the node's path (`_plcProjectPath` + the node name), or check whether the
      node exposes a path-ish property. Record what actually works; do not infer it from the VS DTE docs alone.
- [ ] 4.2 Have `TcObjectModel` record what it touched since the last flush — content writes (`WriteText`) separately
      from STRUCTURAL changes (`CreateChild`/`DeleteChild`/`Rename`), since structure is what the existing comment
      says must be persisted to avoid a later rename colliding with stale files.
- [ ] 4.3 `FlushPendingWrites` saves only those: each touched item's document, plus the containing PLC project when
      structure changed. No seam change needed — the object model mediates every write, so it can track its own
      dirty set.
- [ ] 4.4 A failed scoped save must stay LOUD (already true): durability is this method's whole purpose, so
      reporting success over a failed save is how committed work gets lost.
- [ ] 4.5 Verify: an engineer's unrelated dirty editor is still dirty after a `volt push`, and the pushed item IS on
      disk. Then remove the `ponytail:` marker in `TcObjectModel.FlushPendingWrites`.
