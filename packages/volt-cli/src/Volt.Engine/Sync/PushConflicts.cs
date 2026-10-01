using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;

namespace Volt.Engine.Sync;

/// <summary>Optimistic-concurrency conflict detection for a push: the project-level lease check and the
/// per-item <c>ifVersion</c> gate, simulated forward over the batch so in-batch dependencies validate.
/// <para>PURE — no driver, no IDE, no IO. It takes the pre-apply version map and the ops and returns the
/// conflicts. That is worth its own file because it is the one part of the push that can be reasoned about, and
/// tested, without a project at all.</para></summary>
internal static class PushConflicts
{
    internal static List<PushConflict> DetectConflicts(
        List<PushOp> ops, string? expectedProjectVersion, bool force,
        Dictionary<string, string> currentVersions, string? currentProjectVersion, bool walkComplete,
        IReadOnlyCollection<string> unclassifiable)
    {
        var conflicts = new List<PushConflict>();

        // The project-level gate runs regardless of force — it IS the --force-with-lease check. A null
        // `currentProjectVersion` means the pre-flight skipped the reads that compute it, which it only does
        // when no lease was quoted — so this branch cannot see one.
        if (expectedProjectVersion != null && expectedProjectVersion != currentProjectVersion)
            conflicts.Add(new PushConflict
            {
                Name = ConflictCodes.ProjectName, YourVersion = expectedProjectVersion,
                CurrentVersion = currentProjectVersion,
                Code = ConflictCodes.StaleProjectVersion,
                Reason = "expected project version does not match current project version",
            });

        // Force skips the per-item ifVersion checks entirely (apply unconditionally); the project gate above still ran.
        if (force) return conflicts;

        // Forward simulation: name → version, mutated per op so in-batch dependencies validate. Every op
        // is a SetItemOp or a DeleteItemOp.
        var pending = currentVersions.ToDictionary(kv => kv.Key, kv => (string?)kv.Value);
        foreach (var op in ops)
        {
            var name = op.Name;                       // FULL wire name — echoed back in the conflict
            var bare = Materializer.Bare(name);
            var clientVersion = op.IfVersion;
            // Resolve on the FULL name: that is the identity `refs`/`fetch` publish, so it is the only one the
            // client can have quoted in `ifVersion`. The BARE fallback covers exactly one case — an UNREADABLE
            // item, which never materialized, has no full name, and is therefore keyed bare (DIALECT C7). It is
            // absent from refs, so no client holds a version for it; the fallback exists only so a CREATE cannot
            // land on top of one.
            var key = pending.ContainsKey(name) ? name : bare;
            var currentVersion = pending.TryGetValue(key, out var v) ? v : null;

            // AN OBJECT THE WALK COULD NOT CLASSIFY, under the bare name this op names. Its kind is unknown, so an op on
            // ANY `X.<kind>` that is not a published identity may be that very object: the apply resolves by bare name
            // and would land on it unchecked. Refused as what it is, by name — never a stale-version conflict quoting
            // the sentinel (no pull can satisfy one: the object stays unreadable and no fetch ever sends it), and never
            // through the version map, which keys these objects by a path that is no wire name
            // (`Versioning.CountUnclassifiable`). Force skipped this whole loop above, as it does every item check.
            if (op is SetItemOp && !pending.ContainsKey(name) && unclassifiable.Contains(bare))
            {
                conflicts.Add(new PushConflict
                {
                    Name = name, YourVersion = clientVersion, CurrentVersion = null,
                    Code = BridgeErrorCodes.Unreadable,
                    Reason = $"the IDE holds an object named '{bare}' whose kind the bridge could not read, so it cannot "
                           + "tell whether this item is that object, and a push cannot write it safely. It is named in "
                           + "the `unreadable` list of every refs/fetch. Fix it in the IDE, or push with --force.",
                });
                continue;
            }

            if (op is SetItemOp set)
            {
                if (clientVersion == null)            // create
                {
                    // A DUT IS ONE OBJECT UNDER FOUR NAMES. `X.struct` is absent from the map when the IDE's `X` is
                    // an enum — its identity there is `X.enum` — yet the apply resolves the op by BARE name, finds
                    // that enum and writes the struct over it with no version check. So a DUT create also looks for
                    // the object under its other subtype names: a create must not land on an item that is there,
                    // whatever subtype it has now. DUT names only: `X.fb` beside `X.struct` is two items (the
                    // item-name invariant), never one object.
                    if (currentVersion == null && DutSubtypeChanges.IsDut(name)
                        && pending.FirstOrDefault(kv => DutSubtypeChanges.IsDut(kv.Key)
                               && string.Equals(Materializer.Bare(kv.Key), bare, StringComparison.OrdinalIgnoreCase))
                           is { Key: { } sibling } hit)
                    {
                        conflicts.Add(new PushConflict
                        {
                            Name = name, YourVersion = null, CurrentVersion = hit.Value,
                            Code = ConflictCodes.ItemExists,
                            Reason = $"expected to create new item but the IDE already holds this DUT as '{sibling}' " +
                                     "(a DUT's subtype names are one object). Pull it first; to change its subtype, " +
                                     "rename or replace that file.",
                        });
                        continue;
                    }

                    // AN UNREADABLE ITEM IS ITS OWN SITUATION, not a name collision.
                    //
                    // The refusal is right — a create must not land on top of an item that is there — but it
                    // used to describe itself as "it already exists" and quote `UNREADABLE000000`, the
                    // sentinel `PushService` writes for an item whose body would not materialize. That is a
                    // dead end for the caller: the item left `items`, so the client had no version and sent
                    // `ifVersion: null` (a create) for a file it has had all along; no `refs` or `fetch` ever
                    // hands out the sentinel, so there is no `ifVersion` that would satisfy the guard; and
                    // `volt pull` reports nothing to pull. The only way out was `--force`, which also
                    // relocates the item. So say what is true, and NEVER put the sentinel on the wire.
                    if (currentVersion == Versioning.Unreadable)
                        conflicts.Add(new PushConflict
                        {
                            Name = name,
                            YourVersion = null,
                            CurrentVersion = null,
                            Code = BridgeErrorCodes.Unreadable,
                            Reason = "the IDE has this item but its body could not be read, so it has no "
                                + "version to compare against and a push cannot overwrite it safely. It is "
                                + "named in the `unreadable` list of every refs/fetch. Fix it in the IDE, or "
                                + "push with --force to overwrite it.",
                        });
                    else if (currentVersion != null)
                        conflicts.Add(new PushConflict
                        {
                            Name = name, YourVersion = null, CurrentVersion = currentVersion,
                            Code = ConflictCodes.ItemExists,
                            Reason = "expected to create new item but it already exists",
                        });
                    else pending[name] = "";          // the new item exists for later ops, under its wire name
                }
                else if (currentVersion != clientVersion)   // update / rename / move guard
                {
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion, walkComplete));
                }
                else if (set.ToName is { } toName && !string.Equals(Materializer.Bare(toName), bare, StringComparison.OrdinalIgnoreCase))
                {
                    pending.Remove(key);              // rename: the new identity exists for later ops
                    pending[toName] = "";
                }
            }
            else                                      // DeleteItemOp
            {
                // Delete is idempotent: if the item is already gone (currentVersion == null) the goal state
                // already holds, so it's a no-op success — never a conflict, whatever the ifVersion guard. This
                // also covers the UNREADABLE-sentinel force-delete of an accepted-but-unenumerable item (absent
                // from /refs → currentVersion null here, but Apply still finds and removes it via ide.Lookup).
                // Only a version MISMATCH on a still-PRESENT item is a real conflict.
                //
                // …AND ALL OF THAT DEPENDS ON THE WALK HAVING SEEN EVERYTHING. From a PARTIAL walk, absence is
                // not "already gone", and this rule turns it into one: the item falls through as a no-op
                // success, so the `ifVersion` guard never runs — and `Apply` then finds the item anyway through
                // `ItemLookup.Find` and destroys it. The one op that cannot be undone, carried out without the
                // check that exists to stop exactly that, on an item nobody could read. A client that supplied
                // a version asked to be guarded; when the guard cannot run, the answer is no.
                if (currentVersion == null && !walkComplete && clientVersion != null
                    && clientVersion != Versioning.Unreadable)
                    conflicts.Add(VersionMismatch(name, clientVersion, null, walkComplete));
                else if (currentVersion != null && clientVersion != null && currentVersion != clientVersion)
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion, walkComplete));
                else pending.Remove(key);
            }
        }
        return conflicts;
    }

    /// <summary>The two ways an <c>ifVersion</c> gate fails, told apart BY CODE and not only by which version
    /// field happens to be null.
    ///
    /// <para>The remedies differ and a caller has to be able to branch on them: a stale version means pull that
    /// item, merge and push again; a missing one means there is nothing to merge with, because the item the
    /// client holds a version for is gone from the IDE. Both used to answer `code: null` and an English
    /// sentence, so the e2e suite matched the sentence and the CLI printed it unbranched.</para></summary>
    private static PushConflict VersionMismatch(
        string name, string? clientVersion, string? currentVersion, bool walkComplete)
    {
        // ABSENT FROM A PARTIAL WALK IS NOT GONE. `ItemMissing` says "the item is no longer there", which
        // invites the client to recreate it — and under `force` that is the move it would make, on an item that
        // is almost certainly still sitting in the IDE under a folder this walk could not enumerate. The
        // impaired thing is the BRIDGE, and the two situations read as opposite news to whoever acts on them.
        if (currentVersion == null && !walkComplete)
            return new PushConflict
            {
                Name = name, YourVersion = clientVersion, CurrentVersion = null,
                Code = ConflictCodes.ItemUnverified,
                Reason = "this push could not read the folder this item is in, so it refuses to touch it — "
                       + "absence from a partial walk is not proof the item is gone. See `unwalkedFolders` on "
                       + "refs/fetch, and fix what stops the IDE enumerating it.",
            };
        return new PushConflict
        {
            Name = name, YourVersion = clientVersion, CurrentVersion = currentVersion,
            Code = currentVersion == null ? ConflictCodes.ItemMissing : ConflictCodes.StaleItemVersion,
            Reason = currentVersion == null ? "expected item to exist but it doesn't" : "item changed since you fetched its version",
        };
    }
}
