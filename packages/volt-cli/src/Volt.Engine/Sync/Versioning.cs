using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

/// <summary>Materialize an item once and hash it into its content version — the shared step behind
/// <c>refs</c>, <c>fetch</c>, and the push receipt, so all three agree on a version. No catch: a read
/// failure propagates to the wire boundary rather than silently recording a folder-only hash for empty
/// text (which would drift the version and hide the failure).</summary>
public static class Versioning
{
    /// <summary>The workspace folder an item of this kind ACTUALLY occupies, from the folder the project walk
    /// reported. Today only a referenced library differs: it lives in its own folder beside the element
    /// signatures rendered for it (<see cref="Library.LibraryLayout"/>).
    /// <para>It lives HERE, on the one function every version-producing walk already calls, because "apply the
    /// layout at each call site" is what broke: <c>/fetch</c> applied it to the Changed entry only, so one
    /// response reported the file at <c>Library Manager/</c> while writing it to <c>Library Manager/&lt;lib&gt;/</c>
    /// and hashed the version over the folder it is not in — and <c>/refs</c>, the push receipt and the push's
    /// own lease walk each had their own answer. FOUR call sites, four chances to forget. One function cannot
    /// disagree with itself.</para></summary>
    public static string FolderOf(string kind, string walkedFolder, string name) =>
        kind == ItemKind.Kinds.Library ? Library.LibraryLayout.FolderFor(walkedFolder, name) : walkedFolder;

    public static (string Version, WorkspaceItem Item) Materialize(
        IIdeDriver ide, string name, string kind, ItemRef item, string folder)
    {
        var mat = Materializer.Materialize(ide, name, kind, item);
        return (Hasher.ComputeItemVersion(FolderOf(kind, folder, name), mat.Text), mat);
    }

    /// <summary>The version recorded for an item whose body can't be read (e.g. a malformed graphical POU whose
    /// PLCopen export has no FBD/LD body). Stable, so the item looks unchanged across reads.</summary>
    public const string Unreadable = "UNREADABLE000000";

    /// <summary>Resilient version for the AGGREGATE ops (<c>refs</c>, <c>push</c> project-version): a
    /// single unreadable item must never crash the whole batch — it is isolated with the <see cref="Unreadable"/>
    /// sentinel and still listed/deletable (its <see cref="ItemRef"/> comes from WalkItems, not the read). The
    /// raw <see cref="Materialize"/> stays no-catch for single-item paths where the failure must surface.</summary>
    public static VersionedItem SafeVersion(IIdeDriver ide, string name, string kind, ItemRef item, string folder)
    {
        // An unreadable item is a real error — its body did NOT make it into the pull — so surface it at Warn
        // with the name + reason (not Debug). The old bare catch hid a real materialize bug (FB-with-method /
        // interface) for a long time; a visible Warn is what caught it.
        try { var (v, m) = Materialize(ide, name, kind, item, folder); return new VersionedItem(v, m, name); }
        catch (System.Exception ex)
        {
            VoltLog.Warn($"materialize failed name='{name}' kind='{kind}' — body skipped from pull: {ex.Message}");
            return new VersionedItem(Unreadable, null, name);
        }
    }
}

/// <summary>One item as a version-producing walk sees it: what it hashes to, the text it materialized into (null
/// when it could not be read), and — the reason this type exists — the IDENTITY every map keys it by.
///
/// <para><b>The identity is DERIVED here and nowhere else.</b> Three walks produce version maps (<c>refs</c> via
/// <see cref="ProjectSnapshot"/>, <c>fetch</c>, and the push's own lease walk), and each used to key its map with
/// the bare item name it happened to be holding. Bare names are NOT unique across kinds: a control module and the
/// visualization that draws it are <c>CM_Carrier.fb</c> and <c>CM_Carrier.visualization</c> — two files, two
/// objects in the project tree, one shared slot in every one of those maps, with the walk order deciding which
/// survived. The consequences were a pull that reported "nothing to pull" over a real edit (the shadowed item did
/// not move the aggregate hash) and a push that refused an item by quoting its NEIGHBOUR'S version, so the FB
/// could be pulled and never pushed back. Found on a real customer project, V71_PackML_Hauzer.</para>
///
/// <para>So the identity is the FULL wire name — the name plus its kind extension, which is what <c>refs</c> and
/// <c>fetch</c> publish and therefore the only identity a client can ever quote back. This is not a
/// "duplicate name" guard and adds none: bare-name identity below the vendor seam is untouched, because that is
/// the IDE's own lookup key. It is one rung up, where Volt indexes items for the wire.</para>
///
/// <para>An UNREADABLE item never materialized, so it has no full name and keeps its bare one. It is absent from
/// the wire index either way (DIALECT C7) and no client holds a version for it; the bare key only keeps it
/// counted in the aggregate hash and blocks a create landing on top of it. Re-deriving a full name for it would
/// lean on the very kind mapping that may be what defeated the read.</para></summary>
public sealed class VersionedItem
{
    internal VersionedItem(string version, WorkspaceItem? materialized, string bareName)
    {
        Version = version;
        Materialized = materialized;
        Identity = materialized?.FullName ?? bareName;
    }

    /// <summary>The content version — <see cref="Versioning.Unreadable"/> when the body could not be read.</summary>
    public string Version { get; }

    /// <summary>The materialized text + full name, or null when the item could not be read.</summary>
    public WorkspaceItem? Materialized { get; }

    /// <summary>The key EVERY version/folder map uses for this item. See the type doc — this is the whole point.</summary>
    public string Identity { get; }
}
