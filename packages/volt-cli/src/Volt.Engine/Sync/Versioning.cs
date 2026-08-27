using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Source.Body;
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
    public static string SafeVersion(IIdeDriver ide, string name, string kind, ItemRef item, string folder, out WorkspaceItem? mat)
    {
        // An unreadable item is a real error — its body did NOT make it into the pull — so surface it at Warn
        // with the name + reason (not Debug). The old bare catch hid a real materialize bug (FB-with-method /
        // interface) for a long time; a visible Warn is what caught it.
        try { var (v, m) = Materialize(ide, name, kind, item, folder); mat = m; return v; }
        catch (System.Exception ex) { VoltLog.Warn($"materialize failed name='{name}' kind='{kind}' — body skipped from pull: {ex.Message}"); mat = null; return Unreadable; }
    }
}
