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
