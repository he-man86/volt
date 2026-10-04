## Step 2 — the push answer carries the canonical text (route A)

**Target.** With `PushRequest.returnSources: true`, an accepted push answers `PushResponse.newSources`: full wire name
(`name.kind`, the `newItems` key) → that item's text **exactly as a fetch returns it**, for every item the push
changed: each item a landed `set` op left in the project, and each item whose receipt version differs from the
pre-apply walk's (gate 3 — see below). Test red (2.1): push W1 (FB + PROPERTY before ACTION, body straight into the END line),
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

**Gate 3: "changed" is not "named by an op".** A native rename rewrites the call sites in OTHER items (the
`SetItemOp` contract; `FakeIde.RewritesReferencesOnRename`). Those items get a new `newItems` version and no op names
them, so the step-3 build (landed `set` names only) gave them no entry — and a client that re-reads only pushed names
would adopt the caller's new version over its pre-rename text, so its next patch-and-push of that caller passes
`ifVersion` and writes the old name back. Fix, in the spec's own words ("each item the push changed"): the receipt walk
also keeps the text of every item whose version differs from the pre-apply walk's (or that the pre-apply walk did not
have), except an item a conflict names (`name`, `renamedTo`), which the client re-reads. The pre-apply walk now
materializes when `returnSources` is set even under `--force` (it otherwise skips the reads), because only a pre-apply
version can say what changed. Keys are the IDE's spelling: an op named `fb_motor.pou` that landed on `FB_Motor` is
answered under `FB_Motor.pou`, the `newItems` key (documented on `NewSources`, pinned by a test).

**Migration.** Additive on both sides (nullable request flag, nullable response map, `JsonIgnore` when null): an older
bridge ignores the flag and answers without `newSources`, which a client reads as "re-read". Engine-only, so both
vendors serve it byte-identically (the parity boundary is the wire). The CLI does not set the flag (it already pulls
canonical text into the workspace); PLCAssist does. The generated docs (`docs/assets/data.js` +
`volt-bridge.openrpc.json`, `VOLT_WRITE_DOCS=1`) are regenerated in step 2, WITH the contract fields — not step 3 as
first planned: the doc gate (`DocDataTests`) fails the moment the wire models change, so leaving it for step 3 would
keep an unrelated red in step 2's suite. Step 3 regenerates again only if the field docs change.
