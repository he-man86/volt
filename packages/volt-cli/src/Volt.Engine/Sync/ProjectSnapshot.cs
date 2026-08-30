using System;
using System.Collections.Generic;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>
/// One consistent walk of the project's tracked items into the version + folder maps that BOTH <c>refs</c>
/// and the <c>push</c> receipt report. Having a SINGLE walk here is what guarantees those two agree
/// byte-for-byte — a native rename rewrites the bodies of items OUTSIDE the pushed op set, so a receipt that
/// reused pre-apply versions for "untouched" items reported a stale baseline, and the client (which persists
/// the receipt as its IDE baseline, no follow-up <c>refs</c>) then hit a spurious "pull first" on its next
/// push. Re-materializing every item from the SAME walk <c>refs</c> uses makes that drift impossible.
///
/// The gates match <c>refs</c> exactly: unmapped kinds and container-managers are skipped (exclude-from-build is
/// NOT modeled — an excluded object syncs as an ordinary file, see <see cref="Ide.ProjectItem"/>). <c>fetch</c>
/// keeps its own walk (it layers changed-body + onlyItems + library-signature logic on top) but is documented to
/// produce the same version map for the same gates.
/// </summary>
internal sealed class ProjectSnapshot
{
    /// <summary><see cref="Walk"/> is the only producer — it is what computes the aggregate versions below, so a
    /// snapshot can never exist with unhashed maps.</summary>
    private ProjectSnapshot() { }

    /// <summary>Wire identity → version — the aggregate-hash source (project/structure version).
    /// <para>Keyed by the SAME identity <see cref="FullVersions"/> publishes, and that is load-bearing. It used to
    /// be keyed by the BARE name, where two items of different kinds sharing one name (a control module and its
    /// own visualization — <c>CM_Carrier.fb</c> + <c>CM_Carrier.visualization</c>, which is how CODESYS projects
    /// are normally organised) collapsed onto one slot and the walk order decided which survived. The shadowed
    /// item was then invisible to the aggregate hash, so editing it did not move <c>projectVersion</c> and
    /// <c>volt pull</c> took its "nothing to pull" fast path over a real code change.</para>
    /// <para>An UNREADABLE item has no full name (it never materialized), so it is keyed by its bare name here.
    /// That keeps it counted in the hash while staying absent from the wire index — DIALECT C7, unchanged.</para></summary>
    public Dictionary<string, string> Versions { get; } = new();

    /// <summary>Full name → version — the wire <c>Items</c> map.</summary>
    public Dictionary<string, string> FullVersions { get; } = new();

    /// <summary>Full name → folder path.</summary>
    public Dictionary<string, string> Folders { get; } = new();

    public int Unmapped { get; private set; }

    /// <summary>Items the walk found but could not materialize, BY NAME. A count was enough for a log line; the
    /// names are what let a client say WHICH item did not come through — and an unreadable item is invisible
    /// otherwise, because it is tracked in the version hash but absent from the wire index (DIALECT C7).</summary>
    public List<string> Unreadable { get; } = new List<string>();

    /// <summary>The aggregate versions over <see cref="Versions"/>, hashed ONCE at the end of the walk — they are
    /// part of the snapshot, not recomputed (and re-sorted) per read.</summary>
    public string ProjectVersion { get; private set; } = "";
    public string StructureVersion { get; private set; } = "";

    /// <summary>The single gate that decides whether an item is TRACKED (counts toward the version maps + the
    /// project/structure hash). Used by <see cref="Walk"/> AND by <c>push</c>'s lease baseline so both hash the
    /// SAME item set — a divergent gate there would spuriously reject a push with "pull first". Skips: unmapped
    /// kinds and container-managers (folders, not items).</summary>
    public static bool IsTracked(int kindCode) =>
        ItemKind.Map(kindCode) != null && !ItemKind.IsContainerManager(kindCode);

    /// <summary>Walk every tracked item once, applying the <c>refs</c> gates. <paramref name="operation"/>
    /// labels the streamed progress frames + skip logs (e.g. "refs").</summary>
    public static ProjectSnapshot Walk(IIdeDriver ide, Action<ProgressFrame>? onProgress = null, string operation = Ops.Refs)
    {
        var snap = new ProjectSnapshot();
        // Only the items: a snapshot answers "what is here and what does it hash to", and nothing derives a
        // DELETION from it — the removal signal lives in FetchService alone. Completeness would be noise here.
        var walked = ide.WalkItems().Items;
        var total = walked.Count;
        var done = 0;
        onProgress?.Invoke(new ProgressFrame { Operation = operation, Done = 0, Total = total, Phase = "reading" });

        foreach (var it in walked)
        {
            done++;
            if (onProgress != null && (done % 25 == 0 || done == total))
                onProgress(new ProgressFrame { Operation = operation, Done = done, Total = total });

            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) { snap.Unmapped++; VoltLog.Debug($"{operation} skip: unmapped-kind '{it.Name}' (kindCode={it.KindCode})"); continue; }
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            // The two skips above == !IsTracked(it.KindCode) — kept expanded here for the per-reason counters/logs;
            // PushService's lease hash reuses IsTracked to stay byte-identical.

            // Report the folder the item ACTUALLY occupies — Versioning.FolderOf is the one definition, and
            // SafeVersion applies it to the hash itself, so refs, fetch and the receipt cannot drift apart.
            var folder = Versioning.FolderOf(kind, it.Folder, it.Name);
            var v = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder);
            snap.Versions[v.Identity] = v.Version;
            if (v.Materialized is { } mat) { snap.FullVersions[mat.FullName] = v.Version; snap.Folders[mat.FullName] = folder; }
            else snap.Unreadable.Add(it.Name);
        }
        snap.ProjectVersion = Hasher.ComputeProjectVersion(snap.Versions);
        snap.StructureVersion = Hasher.ComputeStructureVersion(snap.Versions);
        return snap;
    }
}
