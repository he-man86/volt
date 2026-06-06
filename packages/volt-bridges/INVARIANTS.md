# Bridge invariants

This file documents the structural contracts that EVERY Volt bridge
(Beckhoff, CODESYS, and any future TIA / Schneider / B&R adapter) MUST
hold. The two bridges we have today mirror each other deliberately so
that bugs found on one are reproducible on the other and so the agent
code on top is vendor-agnostic.

If you're adding a new bridge, OR a fourth handler to an existing one,
read this first. The simulator (`TestBridge` in
`packages/volt-agent/src/bridge/test-bridge.ts`) is NOT enough — it
proves the AGENT honours these contracts; only a real-IDE round-trip
proves the BRIDGE honours them.

## Invariant 1: Single walker, multiple projections

The three read/write handlers — `/refs`, `/fetch`, `/push` — MUST share
**one** project-tree walker. They project the same traversal into
three different output shapes, but they MUST NOT walk the tree three
different ways.

### Why

`/refs` returns `projectVersion`. `/fetch` returns `projectVersion`.
The agent assumes these are equal at any quiescent moment. If `/refs`
recurses into hybrid containers (e.g. CODESYS `References → libraries`)
but `/fetch` doesn't, the two endpoints return different
`projectVersion`s for the SAME IDE state and every subsequent push
fails with phantom drift.

This was the bug behind this session's structural refactor on TC.
RefsHandler, FetchHandler and PushHandler each had their own
tree-walk; they diverged on hybrid items; the agent saw drift the user
hadn't caused.

### How to add a fourth handler

Use the shared walker:

- **Beckhoff** (`packages/volt-bridges/beckhoff/BeckhoffBridge/BeckhoffConnection.cs`):
  ```csharp
  _connection.WalkProjectTree(visit => {
      // visit.Name, visit.Item, visit.ItemType,
      // visit.IsTopLevelCrud, visit.FolderPath
  });
  ```
- **CODESYS** (`packages/volt-bridges/codesys/CodesysBridge/codesys_connection.py`):
  ```python
  for visit in connection.iter_all_items():
      # visit.name, visit.item, visit.item_type,
      # visit.is_top_level_crud, visit.folder_path
  ```

Do NOT call `GetPlcProjectRoot()` / `iter_top_level()` directly from a
handler. If your handler needs a NEW projection (e.g. a `/diagnostics`
endpoint that walks the tree), add a second visitor — don't add a
second walker.

## Invariant 2: `push.newProjectVersion === next /fetch.projectVersion`

After an accepted `/push`, the agent saves the returned
`newProjectVersion` as its receipt. The next `/fetch` MUST return the
SAME value (assuming nothing else mutated the IDE between calls).

### Why

The agent uses `expectedProjectVersion` on the next push as a
project-level conflict guard. If the bridge's `newProjectVersion`
doesn't match the next `/fetch`, the agent's *correct* receipt looks
*stale* to the bridge, every subsequent push is rejected, and the user
sees self-caused drift.

### How to hold the invariant

If the IDE normalises source on save (TC does this — `Documents.SaveAll`
re-emits `<ST>` with the IDE's own whitespace / Unicode conventions),
the apply path MUST flush BEFORE computing `newProjectVersion`. Read
back from the saved state — not from the in-memory pre-save copy.

- **Beckhoff**: `BeckhoffConnection.FlushPendingWrites()` →
  `dte.Documents.SaveAll()`. Called at the end of `PushHandler.Handle`
  before re-walking to compute `newProjectVersion`. Also called from
  `BuildHandler.Handle` before invoking the build.
- **CODESYS**: Scripting writes are immediate — no flush needed.
  Documented here so a future contributor doesn't add one "for
  symmetry" (the asymmetry is real; it's IDE behaviour, not bridge
  behaviour).

If a new IDE you're adapting also defers writes, follow the TC
pattern: a `FlushPendingWrites()` on the connection, called from
every handler that mutates state, NOT only the one that obviously
needs it (build).

## Invariant 3: itemCache flows through every apply method

The push pre-flight walks the project tree once and builds an
itemCache (`Dictionary<string, dynamic>` / `dict[str, item]`). Every
`apply*` method downstream MUST receive that cache as a parameter and
look up items there FIRST — only falling back to a fresh `find_by_name`
if the name was created during this same push batch.

### Why

Two reasons. **Correctness**: walking the tree multiple times in the
same push handles the same item differently if the tree mutated
between walks (e.g. a `pushItem` that created a folder, followed by a
`moveItem` into that folder). Passing the cache through ensures every
op sees the same authoritative view from the pre-flight walk.

**Performance**: `find_by_name` is O(tree). On a project with
thousands of items, calling it from every apply method is O(N²) in
batch size. The cache makes it O(1).

### How to add a new push op

```csharp
private static void ApplyMyNewOp(JsonObject op, Dictionary<string, dynamic> itemCache) {
    var name = op["name"]!.GetValue<string>();
    var item = ResolveItem(name, itemCache);  // cache.get(name) ?? find_by_name(name)
    // ... mutate item ...
}
```

```python
def _apply_my_new_op(connection, op, item_cache):
    name = op["name"]
    item = item_cache.get(name) or connection.find_by_name(name)
    # ... mutate item ...
```

Both bridges have a `ResolveItem(name, itemCache)` /
`item_cache.get(name) or connection.find_by_name(name)` helper. Use
it. Don't write a fresh lookup in your new op.

## Invariant 4: `/refs` is GET; `/fetch` and `/push` are POST

`/refs` is read-only with no body — GET. `/fetch` and `/push` take a
request body — POST. `/health` is GET. `/build` is POST (it has side
effects).

### Why

The CODESYS bridge strictly enforces method-on-route in its router
layer. The Beckhoff bridge also accepts POST on `/refs` historically
but the parity test asserts the GET shape on both. New endpoints
should follow the convention: side-effect-free → GET, mutating or
takes-a-body → POST.

## Verifying the invariants

Two tests guard this contract:

- **`packages/volt-bridges/parity.test.ts`** — runs the 7 cross-bridge
  contracts against both live bridges. Gated by `VOLT_TC_PORT` +
  `VOLT_CODESYS_PORT`. The post-push-fetch invariant (Invariant 2)
  is one of the 7.
- **`packages/volt-agent/src/cli/full-cycle.test.ts`** — exercises a
  full init → pull → modify → push → pull cycle against ONE bridge.
  Gated by `VOLT_TEST_BRIDGE_PORT`. Catches Invariant 2 in production
  conditions (the simulator can't, because the bug lives in the bridge,
  not the agent).

Both tests skip cleanly when the env vars aren't set, so CI without an
IDE passes through. Run them locally before merging any bridge change:

```bash
# Both IDEs open, with a project each
VOLT_TC_PORT=8555 VOLT_CODESYS_PORT=8556 bun test parity
VOLT_TEST_BRIDGE_PORT=8555 bun test full-cycle  # then again with 8556
```

## What's NOT an invariant

These look like they should be invariants but aren't, on purpose:

- **Item hashes across vendors**: each bridge computes its own
  per-item hash. TC's hash of `PLC_PRG` will not equal CODESYS's hash
  of `PLC_PRG` even if the source is byte-identical. The agent doesn't
  compare hashes across vendors; it stores them per-workspace.
- **Item ordering in responses**: order is not part of the contract.
  The agent treats `items` as a map, never a list. If a new walker
  changes traversal order, no test should fail.
- **`projectName` shape**: TC returns the TwinCAT solution name;
  CODESYS returns the project file basename. Both are display-only —
  used in `/health` for the user's benefit, not as a key.
