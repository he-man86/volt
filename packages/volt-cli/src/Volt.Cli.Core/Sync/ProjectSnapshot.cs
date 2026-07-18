using System;
using System.Collections.Generic;
using Volt.Cli.Core.Diagnostics;
using Volt.Cli.Core.Ide;
using Volt.Cli.Core.Wire;
using Volt.Cli.Core.Workspace;

namespace Volt.Cli.Core.Sync;

/// <summary>
/// One consistent walk of the project's tracked items into the version + folder maps that BOTH <c>/refs</c>
/// and the <c>/push</c> receipt report. Having a SINGLE walk here is what guarantees those two agree
/// byte-for-byte — a native rename rewrites the bodies of items OUTSIDE the pushed op set, so a receipt that
/// reused pre-apply versions for "untouched" items reported a stale baseline, and the client (which persists
/// the receipt as its IDE baseline, no follow-up <c>/refs</c>) then hit a spurious "pull first" on its next
/// push. Re-materializing every item from the SAME walk <c>/refs</c> uses makes that drift impossible.
///
/// The gates match <c>/refs</c> exactly: unmapped kinds, container-managers, and excluded-from-build items are
/// skipped. <c>/fetch</c> keeps its own walk (it layers changed-body + onlyItems + verbose-library logic on
/// top) but is documented to produce the same version map for the same gates.
/// </summary>
public sealed class ProjectSnapshot
{
    /// <summary>Bare name → version — the aggregate-hash source (project/structure version).</summary>
    public Dictionary<string, string> Versions { get; } = new();

    /// <summary>Full name → version — the wire <c>Items</c> map.</summary>
    public Dictionary<string, string> FullVersions { get; } = new();

    /// <summary>Full name → folder path.</summary>
    public Dictionary<string, string> Folders { get; } = new();

    public int Unmapped { get; private set; }
    public int Unreadable { get; private set; }

    public string ProjectVersion => Hasher.ComputeProjectVersion(Versions);
    public string StructureVersion => Hasher.ComputeStructureVersion(Versions);

    /// <summary>The single gate that decides whether an item is TRACKED (counts toward the version maps + the
    /// project/structure hash). Used by <see cref="Walk"/> AND by <c>/push</c>'s lease baseline so both hash the
    /// SAME item set — a divergent gate there would spuriously reject a push with "pull first". Skips: unmapped
    /// kinds and container-managers (folders, not items).</summary>
    public static bool IsTracked(int kindCode) =>
        ItemKind.Map(kindCode) != null && !ItemKind.IsContainerManager(kindCode);

    /// <summary>Walk every tracked item once, applying the <c>/refs</c> gates. <paramref name="operation"/>
    /// labels the streamed progress frames + skip logs (e.g. "refs").</summary>
    public static ProjectSnapshot Walk(IIdeDriver ide, Action<ProgressFrame>? onProgress = null, string operation = "refs")
    {
        var snap = new ProjectSnapshot();
        var walked = ide.WalkItems();
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

            var version = Versioning.SafeVersion(ide, it.Name, kind, it.Item, it.Folder, out var mat);
            snap.Versions[it.Name] = version;
            if (mat != null) { snap.FullVersions[mat.FullName] = version; snap.Folders[mat.FullName] = it.Folder; }
            else snap.Unreadable++;
        }
        return snap;
    }
}
