## Why

A pulled project showed `Library Manager.library_manager` at BOTH its nested `…/Application/` folder AND the repo
root — a byte-identical 17-byte stub, duplicated. Investigation (and `/debug` on the live tree) found the root
cause: a project has two distinct CODESYS **Library Manager** objects (a project-level one and the Application's),
and both materialize as a content-free `.library_manager` stub keyed by the same bare name `Library Manager`. The
CODESYS walk emitted the stub; the TwinCAT walk already treated the library manager as a pure **container** (recurse,
no item). So it was a **parity bug** — CODESYS was the outlier — and the name collision then produced the confusing
duplicate file (and a `/refs`-vs-`/fetch` inconsistency that could orphan one of the two).

## What Changes

- **A container-manager is a folder, not a file.** Library / recipe / visualization managers only group their
  children; `ItemKind.IsContainerManager` is the single classification. The CODESYS walk now recurses them —
  emitting the synthesized library references / recipes / visualizations under a folder named after the manager —
  and emits **no stub item**; the TwinCAT walk's existing "library manager is a container" branch is generalized
  to all three. This matches the "a pure container is just a folder" model.
- **A Core backstop** in `FetchService` + `RefsService` (`if (ItemKind.IsContainerManager(...)) continue;`) makes
  the invariant hold for EVERY vendor structurally, not per-driver — a stray manager can never materialize a stub.
- **`FetchService.changed` is deduped by full name** to match the name-keyed `Items`/`versions` maps, so any
  legitimately-repeated opaque name (IEC guarantees uniqueness only for source) can never orphan a duplicate file.

## Impact

- `packages/volt-bridge` — `Workspace/ItemKind.cs` (`IsContainerManager`), `Volt.Bridge.Codesys/Driver/CodesysDriver.Tree.cs`,
  `Volt.Bridge.Beckhoff/Driver/BeckhoffDriver.Tree.cs`, `Core/Sync/FetchService.cs`, `Core/Sync/RefsService.cs`.
- **Parity**: the Core backstop is vendor-agnostic; both bridges behave identically.
- **Verified**: all 5 corpus projects (CodesysTestProject, bakon-nano, awa-palletizer, pro2193, lenze-mid)
  re-fetched from live CODESYS — **zero `.library_manager`/`.recipe_manager`/`.visualization_manager` stubs**, no
  root duplicates, libraries intact under `Library Manager/<lib>/<lib>.library`.
