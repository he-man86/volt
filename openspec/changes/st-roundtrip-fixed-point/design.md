## Step 2 — the push answer carries the canonical text (route A)

**Target.** With `PushRequest.returnSources: true`, an accepted push answers `PushResponse.newSources`: full wire name
(`name.kind`, the `newItems` key) → that item's text **exactly as a fetch returns it**, for every item a landed
`set` op left in the project. Test red (2.1): push W1 (FB + PROPERTY before ACTION, body straight into the END line),
a GVL and a DUT with the flag, and assert `newSources[name] == FetchService.Handle(...).SourceText` and that its
`newItems` version equals the fetched version — compared against a FETCH on the same FakeIde, never against
`PushThenFetchShapeTests.Canonical`. Plus: flag absent → `newSources` absent; a rename+edit is keyed by the NEW name;
on a partial push only landed ops have an entry. The contract fields land in step 2 (always null) so the tests
compile and fail on the value, not on the build.

**Choice: take the text from the receipt walk.** Measured in the code: the receipt is `ProjectSnapshot.Walk`, which
already materializes EVERY item through `Versioning.SafeVersion` → `Materializer.Materialize` → `StWriter.Write` — the
same path `FetchService` renders with — and hashes that text into the version `newItems` carries. The text is in hand;
`ProjectSnapshot` keeps `WorkspaceItem.Text` for the changed names instead of dropping it. Zero extra IDE reads, and
text and version come from one materialization, so they cannot disagree.

Rejected, one line each:
- (B) keep the pushed order/blank line — breaks stable workspace diffs (0.1); not built.
- normalise the PUSHED text (`StReader` → `StWriter`) without the IDE — is not what a fetch gives whenever the IDE
  changes the text (a native rename rewrites the header, DIALECT C2o; graphical bodies come back canonical/rematerialized).
- a per-item `ReadContent` after the receipt — a second read of what the walk just read, and a second chance to differ.
- return every item's text, or on by default — answer size scales with the project; the owner asked for opt-in.

**Stays refused / absent, by name (no placeholder text):**
- a rejected push (`accepted:false`) → no `newSources`; nothing landed.
- an op in `conflicts` (refused or `NOT_ATTEMPTED`) → no entry; a `partiallyApplied` op is re-read by the client, as
  its doc already says.
- a `delete` → no entry.
- a changed item the receipt could not materialize (unreadable, or under an `unwalkedFolders` folder) → no entry, and
  it is equally absent from `newItems`: the one rule is `newSources` keys ⊆ `newItems` keys. A client finding a pushed
  name missing re-reads it and gets the fetch's own refusal; the engine never invents text for it.

**Migration.** Additive on both sides (nullable request flag, nullable response map, `JsonIgnore` when null): an older
bridge ignores the flag and answers without `newSources`, which a client reads as "re-read". Engine-only, so both
vendors serve it byte-identically (the parity boundary is the wire). The CLI does not set the flag (it already pulls
canonical text into the workspace); PLCAssist does. `docs/wire.html` + `volt-bridge.openrpc.json` regenerated
(`VOLT_WRITE_DOCS=1`) in step 3.
