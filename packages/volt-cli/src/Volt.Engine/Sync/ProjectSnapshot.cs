using System;
using System.Collections.Generic;
using System.Diagnostics;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>
/// One consistent walk of the project's tracked items into the version map that <c>refs</c>, <c>fetch</c>
/// and the <c>push</c> receipt report. Having a SINGLE walk here is what guarantees those agree
/// byte-for-byte — the IDE can change items OUTSIDE the pushed op set while the push runs (an engineer's
/// edit), so a receipt that
/// reused pre-apply versions for "untouched" items reported a stale baseline, and the client (which persists
/// the receipt as its IDE baseline, no follow-up <c>refs</c>) then hit a spurious "pull first" on its next
/// push. Re-materializing every item from the SAME walk <c>refs</c> uses makes that drift impossible.
///
/// The gates match <c>refs</c> exactly: unmapped kinds and container-managers are skipped (an object excluded from
/// build is an ordinary item, see <see cref="Item.ProjectItem"/>). <c>fetch</c> layers changed-body, onlyItems and
/// library-signature logic on top through the per-item hook (<see cref="Walk"/>'s <c>onItem</c>), so it cannot gate
/// differently (EndpointParityTests).
/// </summary>
internal sealed class ProjectSnapshot
{
    /// <summary><see cref="Walk"/> is the only producer — it is what computes the aggregate versions below, so a
    /// snapshot can never exist with unhashed maps.</summary>
    private ProjectSnapshot() { }

    /// <summary>Wire identity (the item's PATH) → version — the aggregate-hash source (project version).
    /// <para>Keyed by the SAME identity <see cref="FullVersions"/> publishes, and that is load-bearing. It used to
    /// be keyed by the BARE name, where two items of different kinds sharing one name (a control module and its
    /// own visualization — <c>CM_Carrier.pou</c> + <c>CM_Carrier.visualization</c>, which is how CODESYS projects
    /// are normally organised) collapsed onto one slot and the walk order decided which survived. The shadowed
    /// item was then invisible to the aggregate hash, so editing it did not move <c>projectVersion</c> and
    /// <c>volt pull</c> took its "nothing to pull" fast path over a real code change.</para>
    /// <para>An UNREADABLE item is keyed by its path here too (the walk states its kind). That keeps it counted in the
    /// hash while it stays absent from the wire index — DIALECT C7.</para></summary>
    public Dictionary<string, string> Versions { get; } = new();

    /// <summary>Item path → version — the wire <c>Items</c> map.</summary>
    public Dictionary<string, string> FullVersions { get; } = new();

    /// <summary>The root of every application the walk passed (<see cref="WalkResult.Applications"/>) — the wire
    /// <c>applications</c> list.</summary>
    public List<string> Applications { get; } = new();

    /// <summary>Item path → the item's materialized text, for the items the caller asked to keep
    /// (<c>keepText</c>) and nothing else — the push answer's <c>newSources</c> (openspec
    /// <c>st-roundtrip-fixed-point</c>). It is the SAME materialization <see cref="FullVersions"/>' version hashes and
    /// the one <c>fetch</c> renders (<c>Versioning.SafeVersion</c> → <c>StWriter</c>), so text and version cannot
    /// disagree, and no item is read a second time. An item that did not materialize has no entry here, as it has none
    /// in <see cref="FullVersions"/>.</summary>
    public Dictionary<string, string> Texts { get; } = new(StringComparer.Ordinal);

    public int Unmapped { get; private set; }

    /// <summary>How many objects the driver's walk returned, tracked or not — the progress bar's denominator.</summary>
    public int Walked { get; private set; }

    /// <summary>Items the walk found and did not read, BY PATH — the wire <c>unreadable</c> list, in
    /// <see cref="WireOrder{T}"/>. A count was enough for a log line; the paths are what let a client say WHICH item
    /// did not come through — and an unreadable item is invisible otherwise, because it is tracked in the version hash
    /// but absent from the wire index (DIALECT C7).</summary>
    public List<UnreadableItem> Unreadable { get; } = new List<UnreadableItem>();

    /// <summary>Tree nodes with no file the walk did not read, by node path — the wire <c>unreadableNodes</c> list, in
    /// <see cref="WireOrder{T}"/>.</summary>
    public List<UnreadableNode> UnreadableNodes { get; } = new List<UnreadableNode>();

    /// <summary>THE order every read op names both lists in — by name, then reason, ordinally — so refs and fetch
    /// answer one list (environment-dependency-audit 2.5b: with two unreadable items on 3.5.18.30 refs kept the walk's
    /// order and fetch sorted, and a client comparing them saw a disagreement that was not there).</summary>
    private static List<T> WireOrder<T>(IEnumerable<T> entries, Func<T, string> name, Func<T, string> reason) =>
        entries.OrderBy(name, StringComparer.Ordinal).ThenBy(reason, StringComparer.Ordinal).ToList();

    /// <summary>Folders the driver could not enumerate. Non-empty means "there may be items under here this
    /// walk did not see" — never "these are gone". Everything derived from this snapshot is partial when it
    /// is non-empty, including both aggregate versions.</summary>
    public List<string> UnwalkedFolders { get; } = new List<string>();

    /// <summary>The aggregate versions over <see cref="Versions"/>, hashed ONCE at the end of the walk — they are
    /// part of the snapshot, not recomputed (and re-sorted) per read.</summary>
    public string ProjectVersion { get; private set; } = "";

    /// <summary>The single gate that decides whether an item is TRACKED (counts toward the version maps + the
    /// project/structure hash). Used by <see cref="Walk"/> AND by <c>push</c>'s lease baseline so both hash the
    /// SAME item set — a divergent gate there would spuriously reject a push with "pull first". Skips: unmapped
    /// kinds and container-managers (folders, not items).</summary>
    public static bool IsTracked(int kindCode) =>
        ItemKind.Map(kindCode) != null && !ItemKind.IsContainerManager(kindCode);

    /// <summary>Walk every tracked item once, applying the <c>refs</c> gates. <paramref name="operation"/>
    /// labels the streamed progress frames + skip logs (e.g. "refs"). <paramref name="keepText"/> is asked, for each
    /// materialized item, with its path and the version this walk computed, whether <see cref="Texts"/> keeps
    /// its text; null keeps none. <paramref name="phase"/> is the first progress frame's phase.
    /// <para><paramref name="onItem"/> is called for every TRACKED item once the snapshot has recorded it — the item,
    /// its wire kind, the folder it is reported under (<c>Versioning.FolderOf</c>) and its version — so a caller that
    /// needs more of each item (<c>fetch</c>) adds to this walk instead of keeping a second copy of its gates.</para>
    /// <para>The WALK reports too, before any item is read (openspec <c>twincat-large-solution-refs</c>): one frame per
    /// application as the driver finishes walking it — <c>phase: "walking"</c>, <c>done</c> applications of
    /// <c>total</c> (null where the vendor learns its applications as it walks) — so a client sees work through a walk
    /// that takes minutes on a large TwinCAT solution. <paramref name="clock"/>, when given, records where the time went
    /// (<see cref="SnapshotClock"/>).</para></summary>
    public static ProjectSnapshot Walk(IIdeDriver ide, Action<ProgressFrame>? onProgress = null, string operation = Ops.Refs,
                                       Func<string, string, bool>? keepText = null, string? phase = "reading",
                                       Action<ProjectItem, string, string, VersionedItem>? onItem = null,
                                       SnapshotClock? clock = null)
    {
        var snap = new ProjectSnapshot();
        var time = clock ?? new SnapshotClock();
        var observer = new WalkObserver((application, walkedApps, apps) =>
        {
            time.ApplicationWalked(application);
            onProgress?.Invoke(new ProgressFrame { Operation = operation, Done = walkedApps, Total = apps, Phase = ProgressFrame.WalkingPhase });
        });
        // COMPLETENESS TRAVELS WITH THE ITEMS: `refs` drives `volt status`, which renders every item under an
        // unenumerable folder as INCOMING-REMOVED unless the snapshot says the walk did not see it.
        var walk = ide.WalkItems(observer);
        time.Walked(observer);
        var walked = walk.Items;
        snap.UnwalkedFolders.AddRange(walk.UnwalkedFolders);
        snap.Applications.AddRange(walk.Applications);
        var total = walked.Count;
        snap.Walked = total;
        var done = 0;
        onProgress?.Invoke(new ProgressFrame { Operation = operation, Done = 0, Total = total, Phase = phase });

        foreach (var it in walked)
        {
            done++;
            if (onProgress != null && (done % 25 == 0 || done == total))
                onProgress(new ProgressFrame { Operation = operation, Done = done, Total = total });

            var kind = ItemKind.Map(it.KindCode);
            if (kind == null) { snap.Unmapped++; VoltLog.Debug($"{operation} skip: unmapped-kind '{it.Name}' (kindCode={it.KindCode})"); continue; }
            // A container-manager (library / recipe / visualization manager) is a FOLDER, never a tracked item. The
            // driver walks already avoid emitting it; this is the Core backstop, so no vendor can materialize a stray
            // manager as a stub file.
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            // The two skips above == !IsTracked(it.KindCode) — kept expanded here for the per-reason counters/logs;
            // PushService's lease hash reuses IsTracked to stay byte-identical.

            // Hasher REQUIRES a folder: defaulting a missing one to "" would hash identically to a legitimately
            // empty folder and silently drift the item's version instead of surfacing the walk bug. So fail loud.
            var walkedFolder = it.Folder ?? throw new BridgeException(BridgeErrorCodes.InternalError,
                $"the project walk returned item '{it.Name}' with no folder");
            // Report the folder the item ACTUALLY occupies — Versioning.FolderOf is the one definition (a `.library`
            // lives in its OWN folder beside its signatures), and SafeVersion applies it to the hash itself, so refs,
            // fetch and the receipt cannot drift apart.
            var folder = Versioning.FolderOf(kind, walkedFolder, it.Name);
            time.Materializing(Versioning.PathOf(kind, walkedFolder, it.Name));
            var started = Stopwatch.GetTimestamp();
            var v = Versioning.SafeVersion(ide, it.Name, kind, it.Item, walkedFolder);
            time.Materialized(ItemPath.ApplicationOf(walkedFolder, walk.Applications), kind,
                              (Stopwatch.GetTimestamp() - started) * 1000 / Stopwatch.Frequency);
            snap.Versions[v.Identity] = v.Version;
            if (v.Materialized is { } mat)
            {
                snap.FullVersions[v.Identity] = v.Version;
                if (keepText is not null && keepText(v.Identity, v.Version)) snap.Texts[v.Identity] = mat.Text;
            }
            // An item that could not be READ has not gone anywhere — it is in the hash with the Unreadable sentinel, and
            // listed by its path, so the removal pass does not read "absent" as "deleted" for it, and for it alone.
            else snap.Unreadable.Add(v.Unread!);
            onItem?.Invoke(it, kind, folder, v);
        }
        // Objects the walk saw and did not read: in the hash (they exist) and listed — by the one rule every walk
        // applies (Versioning.CountUnclassifiable), so refs, fetch and the push gate agree. An item's removal exemption is
        // its path in `Unreadable`; an object of unknown kind's is its FOLDER (WalkResult puts it in UnwalkedFolders).
        var (items, nodes) = Versioning.CountUnclassifiable(walk, snap.Versions);
        var named = WireOrder(snap.Unreadable.Concat(items), u => u.Name, u => u.Reason);
        snap.Unreadable.Clear();
        snap.Unreadable.AddRange(named);
        snap.UnreadableNodes.AddRange(WireOrder(nodes, u => u.Name, u => u.Reason));
        snap.ProjectVersion = Hasher.ComputeProjectVersion(snap.Versions);
        time.Done();
        return snap;
    }
}
