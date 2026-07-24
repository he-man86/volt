using System;

namespace Volt.Engine.Ide;

/// <summary>The one DATA-SAFETY policy shared by both drivers' <c>WriteXml</c>: replace a POU by re-import, and if
/// the import fails, restore the original once and rethrow — so a bad edit can NEVER lose or move a POU. Pinned here
/// (not hand-copied into each driver) because a per-vendor drift in this policy is a silent data-loss bug on that
/// vendor. The vendor supplies the primitives (export/delete/import); the ORDER and the restore guard live once.
/// PLCopenXML carries no folder membership, so a driver's import primitive must target the item's ORIGINAL parent,
/// never the project root.</summary>
public static class PlcOpenTransport
{
    public static void ReplaceByReimport(Func<string> exportOriginal, Action delete, Action<string> import, string xml)
    {
        var original = exportOriginal(); // capture BEFORE the delete — the restore copy
        delete();
        try { import(xml); }
        catch { import(original); throw; } // single restore attempt, then rethrow loudly
    }
}
