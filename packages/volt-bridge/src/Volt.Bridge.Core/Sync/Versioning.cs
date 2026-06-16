using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary>Materialize an item once and hash it into its content version — the shared step behind
/// <c>/refs</c>, <c>/fetch</c>, and the push receipt, so all three agree on a version. No catch: a read
/// failure propagates to the HTTP boundary rather than silently recording a folder-only hash for empty
/// text (which would drift the version and hide the failure).</summary>
public static class Versioning
{
    public static (string Version, WorkspaceItem Item) Materialize(
        IIdeDriver ide, string name, string kind, ItemRef item, string folder)
    {
        var mat = Materializer.Materialize(ide, name, kind, item);
        return (Hasher.ComputeItemVersion(folder, mat.Text), mat);
    }
}
