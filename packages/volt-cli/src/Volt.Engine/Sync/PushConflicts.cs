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
        Dictionary<string, string> currentVersions, string currentProjectVersion)
    {
        var conflicts = new List<PushConflict>();

        // The project-level gate runs regardless of force — it IS the --force-with-lease check.
        if (expectedProjectVersion != null && expectedProjectVersion != currentProjectVersion)
            conflicts.Add(new PushConflict
            {
                Name = "<project>", YourVersion = expectedProjectVersion,
                CurrentVersion = currentProjectVersion,
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

            if (op is SetItemOp set)
            {
                if (clientVersion == null)            // create
                {
                    if (currentVersion != null)
                        conflicts.Add(new PushConflict { Name = name, YourVersion = null, CurrentVersion = currentVersion, Reason = "expected to create new item but it already exists" });
                    else pending[name] = "";          // the new item exists for later ops, under its wire name
                }
                else if (currentVersion != clientVersion)   // update / rename / move guard
                {
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion));
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
                if (currentVersion != null && clientVersion != null && currentVersion != clientVersion)
                    conflicts.Add(VersionMismatch(name, clientVersion, currentVersion));
                else pending.Remove(key);
            }
        }
        return conflicts;
    }

    private static PushConflict VersionMismatch(string name, string? clientVersion, string? currentVersion) =>
        new() { Name = name, YourVersion = clientVersion, CurrentVersion = currentVersion,
                Reason = currentVersion == null ? "expected item to exist but it doesn't" : "item changed since you fetched its version" };
}
