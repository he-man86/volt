using System;
using System.Collections.Generic;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Vocabulary;

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

    /// <summary>Bare name → version — the aggregate-hash source (project/structure version).</summary>
    public Dictionary<string, string> Versions { get; } = new();

    /// <summary>Full name → version — the wire <c>Items</c> map.</summary>
    public Dictionary<string, string> FullVersions { get; } = new();

    /// <summary>Full name → folder path.</summary>
    public Dictionary<string, string> Folders { get; } = new();

    public int Unmapped { get; private set; }
    public int Unreadable { get; private set; }

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
            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out var mat);
            snap.Versions[it.Name] = version;
            if (mat != null) { snap.FullVersions[mat.FullName] = version; snap.Folders[mat.FullName] = folder; }
            else snap.Unreadable++;
        }
        snap.ProjectVersion = Hasher.ComputeProjectVersion(snap.Versions);
        snap.StructureVersion = Hasher.ComputeStructureVersion(snap.Versions);
        return snap;
    }
}
